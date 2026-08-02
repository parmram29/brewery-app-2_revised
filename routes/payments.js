const router = require('express').Router();
const db = require('../db/pool');
const { rateLimit } = require('../lib/security');

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  // Lazily constructed so the app still boots without Stripe configured yet.
  const Stripe = require('stripe');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

// GET /api/payments/config — tells the frontend whether card payments are live,
// without ever exposing the secret key.
router.get('/config', (req, res) => {
  res.json({ ok: true, cardPaymentsEnabled: !!process.env.STRIPE_SECRET_KEY, whatsapp: process.env.WHATSAPP_NUMBER || '' });
});

// POST /api/payments/checkout-session — build a Stripe-hosted Checkout Session for
// an existing unpaid order. Card details are entered on Stripe's page and never
// touch this server, keeping us out of PCI card-data scope (SAQ A).
router.post('/checkout-session', rateLimit('checkout-session', 15, 10 * 60 * 1000), async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ ok: false, error: 'Card payments are not configured yet. Please choose cash, or contact us on WhatsApp.' });

  // Looked up by order_ref, not the sequential id. The ref is unguessable
  // (crypto.randomBytes), so possessing it is the customer's capability to pay
  // that order. Accepting a plain integer id let anyone walk 1,2,3… and open a
  // checkout for other people's orders, confirming which ids exist.
  const { order_ref } = req.body;
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

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: items.map(i => ({
        quantity: i.quantity,
        price_data: {
          currency: 'xcd',
          unit_amount: Math.round(parseFloat(i.unit_price) * 100),
          product_data: {
            name: i.size ? `${i.item_name} (${i.size})` : i.item_name,
            description: i.special_instructions || undefined,
          },
        },
      })),
      client_reference_id: order.order_ref,
      metadata: { order_id: String(order.id), order_ref: order.order_ref },
      success_url: `${clientUrl}/?paid=1&ref=${encodeURIComponent(order.order_ref)}`,
      cancel_url: `${clientUrl}/?paycancelled=1&ref=${encodeURIComponent(order.order_ref)}`,
    });

    await db.query('UPDATE orders SET stripe_session_id = ?, payment_method = ? WHERE id = ?', [session.id, 'card', order.id]);
    await db.query(
      'INSERT INTO payment_events (order_id, event, method, amount_ec, detail) VALUES (?, ?, ?, ?, ?)',
      [order.id, 'checkout_session_created', 'card', order.total_ec, session.id]
    ).catch(() => {});
    res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error('Stripe checkout session error:', err.message);
    res.status(500).json({ ok: false, error: 'Could not start checkout. Please try again.' });
  }
});

// POST /api/payments/webhook — Stripe calls this server-to-server when a payment
// completes. The signature is verified so only genuine Stripe events are trusted;
// this is the ONLY place an order is ever marked paid.
router.post('/webhook', async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).send('Stripe not configured');

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const session = event.data.object;

    if (event.type === 'checkout.session.completed' && session.payment_status === 'paid') {
      // `AND payment_status <> 'paid'` makes this idempotent. Stripe retries a
      // webhook until it gets a 2xx, and duplicate deliveries are normal — without
      // the guard each retry rewrites paid_at and logs a duplicate audit row.
      const [result] = await db.query(
        `UPDATE orders
            SET payment_status = 'paid',
                status = IF(status = 'pending', 'confirmed', status),
                paid_at = NOW()
          WHERE stripe_session_id = ? AND payment_status <> 'paid'`,
        [session.id]
      );
      if (result.affectedRows > 0) {
        await db.query(
          `INSERT INTO payment_events (order_id, event, method, amount_ec, detail)
           SELECT id, 'payment_confirmed', 'card', total_ec, ? FROM orders WHERE stripe_session_id = ?`,
          [session.payment_intent || session.id, session.id]
        ).catch(() => {});
      }
    }

    // A customer who abandons checkout leaves the order pending forever
    // otherwise, with a stale session id that blocks re-checkout.
    if (event.type === 'checkout.session.expired') {
      await db.query(
        `UPDATE orders SET stripe_session_id = NULL
          WHERE stripe_session_id = ? AND payment_status <> 'paid'`,
        [session.id]
      );
    }

    if (event.type === 'checkout.session.async_payment_failed') {
      await db.query(
        `UPDATE orders SET payment_status = 'failed'
          WHERE stripe_session_id = ? AND payment_status <> 'paid'`,
        [session.id]
      );
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handling error:', err.message);
    res.status(500).send('Webhook handler error');
  }
});

module.exports = router;
