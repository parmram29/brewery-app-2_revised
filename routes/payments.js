// ============================================================
// Payment routes — provider-agnostic.
//
// Nothing here knows which gateway is in use. Switching between Republic
// Bank EPay and WiPay is a PAYMENT_PROVIDER change plus a completed
// provider file; this file does not change.
// ============================================================

const router = require('express').Router();
const db = require('../db/pool');
const { rateLimit } = require('../lib/security');
const { getProvider } = require('../lib/payments');

/** Best-effort audit write — never fails the request it is logging. */
async function logEvent(orderId, event, method, amount, detail) {
  try {
    await db.query(
      'INSERT INTO payment_events (order_id, event, method, amount_ec, detail) VALUES (?, ?, ?, ?, ?)',
      [orderId, event, method, amount, detail ? String(detail).slice(0, 255) : null]
    );
  } catch (err) {
    console.error('payment_events write failed:', err.message);
  }
}

// GET /api/payments/config — tells the frontend whether to offer the card
// option. Never exposes keys; the provider name is not sensitive.
router.get('/config', (req, res) => {
  const provider = getProvider();
  res.json({
    ok: true,
    cardPaymentsEnabled: provider.isConfigured(),
    provider: provider.name,
    whatsapp: process.env.WHATSAPP_NUMBER || '',
  });
});

// POST /api/payments/checkout-session — start a hosted payment for an
// existing unpaid order. Card details are entered on the provider's page and
// never reach this server, which is what keeps us in PCI DSS SAQ A scope.
router.post('/checkout-session', rateLimit('checkout-session', 15, 10 * 60 * 1000), async (req, res) => {
  const provider = getProvider();
  if (!provider.isConfigured()) {
    return res.status(503).json({
      ok: false,
      error: 'Card payments are not set up yet. Please choose cash, or contact us on WhatsApp.',
    });
  }

  // Looked up by order_ref, never a sequential id: the ref is unguessable
  // (crypto.randomBytes), so holding it is the customer's capability to pay
  // that specific order. An integer id would let anyone walk 1,2,3… and open
  // checkouts for other people's orders.
  const { order_ref } = req.body || {};
  if (typeof order_ref !== 'string' || !order_ref.trim()) {
    return res.status(400).json({ ok: false, error: 'Order reference required' });
  }

  try {
    const [[order]] = await db.query('SELECT * FROM orders WHERE order_ref = ?', [order_ref.trim()]);
    if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });
    if (order.payment_status === 'paid') return res.status(409).json({ ok: false, error: 'This order is already paid' });
    if (order.status === 'cancelled') return res.status(409).json({ ok: false, error: 'This order was cancelled' });

    const [items] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    if (!items.length) return res.status(400).json({ ok: false, error: 'Order has no items' });

    const clientUrl = (process.env.CLIENT_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const ref = encodeURIComponent(order.order_ref);

    const { redirectUrl, paymentRef } = await provider.createCheckout({
      order,
      items,
      successUrl: `${clientUrl}/?paid=1&ref=${ref}`,
      cancelUrl: `${clientUrl}/?paycancelled=1&ref=${ref}`,
    });

    await db.query(
      'UPDATE orders SET payment_ref = ?, payment_provider = ?, payment_method = ? WHERE id = ?',
      [paymentRef, provider.name, 'card', order.id]
    );
    await logEvent(order.id, 'checkout_started', 'card', order.total_ec, paymentRef);

    res.json({ ok: true, url: redirectUrl });
  } catch (err) {
    console.error('Checkout creation failed:', err.message);
    res.status(500).json({ ok: false, error: 'Could not start checkout. Please try again.' });
  }
});

// POST /api/payments/webhook — the provider's server-to-server confirmation.
//
// This is the ONLY place an order is ever marked paid by card. The customer's
// browser landing on the success URL is cosmetic and proves nothing — anyone
// can visit that URL without paying. Only a signature-verified message from
// the provider is trusted.
router.post('/webhook', async (req, res) => {
  const provider = getProvider();
  if (!provider.isConfigured()) return res.status(503).send('Payments not configured');

  let result;
  try {
    result = await provider.verifyCallback(req);
  } catch (err) {
    console.error('Callback verification threw:', err.message);
    return res.status(400).send('Callback error');
  }

  if (!result || !result.verified) {
    // Either a forgery or a misconfigured signing secret. Never act on it.
    console.error('Rejected unverified payment callback:', result?.detail || 'no detail');
    return res.status(400).send('Signature verification failed');
  }

  try {
    const { paymentRef, outcome, detail } = result;

    if (outcome === 'paid') {
      // `AND payment_status <> 'paid'` makes this idempotent: providers retry
      // callbacks until they get a 2xx, and duplicate deliveries are normal.
      const [update] = await db.query(
        `UPDATE orders
            SET payment_status = 'paid',
                status = IF(status = 'pending', 'confirmed', status),
                paid_at = NOW()
          WHERE payment_ref = ? AND payment_status <> 'paid'`,
        [paymentRef]
      );
      if (update.affectedRows > 0) {
        const [[order]] = await db.query('SELECT id, total_ec FROM orders WHERE payment_ref = ?', [paymentRef]);
        if (order) await logEvent(order.id, 'payment_confirmed', 'card', order.total_ec, detail);
      }
    }

    if (outcome === 'expired') {
      // Frees the order so the customer can start a fresh checkout; an
      // abandoned attempt would otherwise leave a stale ref blocking retry.
      await db.query(
        `UPDATE orders SET payment_ref = NULL WHERE payment_ref = ? AND payment_status <> 'paid'`,
        [paymentRef]
      );
    }

    if (outcome === 'failed') {
      await db.query(
        `UPDATE orders SET payment_status = 'failed' WHERE payment_ref = ? AND payment_status <> 'paid'`,
        [paymentRef]
      );
      const [[order]] = await db.query('SELECT id, total_ec FROM orders WHERE payment_ref = ?', [paymentRef]);
      if (order) await logEvent(order.id, 'payment_failed', 'card', order.total_ec, detail);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Callback handling error:', err.message);
    res.status(500).send('Callback handler error');
  }
});

module.exports = router;
