// ============================================================
// Stripe Checkout provider.
//
// NOTE ON AVAILABILITY: Stripe does not currently onboard merchants in
// Grenada. This implementation is kept because it is complete, tested,
// and correct for any region Stripe does serve — but for a Grenada-based
// business the live provider is expected to be Republic Bank EPay
// (see ./epay.js). Selected with PAYMENT_PROVIDER=stripe.
// ============================================================

const { PaymentProvider } = require('./provider');

class StripeProvider extends PaymentProvider {
  get name() { return 'stripe'; }

  get callbackBodyFormat() {
    // Signature is computed over the exact bytes, so the body must not be
    // parsed before it reaches verifyCallback().
    return 'raw';
  }

  isConfigured() { return !!process.env.STRIPE_SECRET_KEY; }

  /** Lazily constructed so the app boots fine with Stripe unconfigured. */
  _client() {
    const Stripe = require('stripe');
    return new Stripe(process.env.STRIPE_SECRET_KEY);
  }

  async createCheckout({ order, items, successUrl, cancelUrl }) {
    const session = await this._client().checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: items.map(i => ({
        quantity: i.quantity,
        price_data: {
          currency: 'xcd',
          // XCD is a 2-decimal currency, so the minor unit is cents.
          unit_amount: Math.round(parseFloat(i.unit_price) * 100),
          product_data: {
            name: i.size ? `${i.item_name} (${i.size})` : i.item_name,
            description: i.special_instructions || undefined,
          },
        },
      })),
      client_reference_id: order.order_ref,
      metadata: { order_ref: order.order_ref },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return { redirectUrl: session.url, paymentRef: session.id };
  }

  async verifyCallback(req) {
    let event;
    try {
      event = this._client().webhooks.constructEvent(
        req.body,
        req.headers['stripe-signature'],
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      // Unverified: could be a forgery, or a misconfigured webhook secret.
      return { verified: false, outcome: 'ignored', detail: err.message };
    }

    const session = event.data.object;
    const base = { verified: true, paymentRef: session.id };

    switch (event.type) {
      case 'checkout.session.completed':
        return session.payment_status === 'paid'
          ? { ...base, outcome: 'paid', detail: session.payment_intent || session.id }
          : { ...base, outcome: 'ignored' };
      case 'checkout.session.expired':
        return { ...base, outcome: 'expired' };
      case 'checkout.session.async_payment_failed':
        return { ...base, outcome: 'failed' };
      default:
        return { ...base, outcome: 'ignored' };
    }
  }
}

module.exports = { StripeProvider };
