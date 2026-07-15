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

  const { order_id } = req.body;
  try {
    const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [order_id]);
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
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.payment_status === 'paid') {
        await db.query(
          `UPDATE orders SET payment_status = 'paid', status = IF(status = 'pending', 'confirmed', status), paid_at = NOW()
           WHERE stripe_session_id = ?`,
          [session.id]
        );
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handling error:', err.message);
    res.status(500).send('Webhook handler error');
  }
});

module.exports = router;
