// ============================================================
// Provider selection. PAYMENT_PROVIDER picks the implementation:
//
//   none    (default) — cash only; the card option never appears
//   epay    — Republic Bank EPay (see ./epay.js — needs completing)
//   stripe  — Stripe Checkout (not available to Grenada merchants)
//
// Defaulting to 'none' is deliberate: an unconfigured deployment offers
// cash rather than showing customers a card button that fails.
// ============================================================

const { PaymentProvider } = require('./provider');
const { StripeProvider } = require('./stripe');
const { EPayProvider } = require('./epay');

/** Provider used when none is configured — card payments simply off. */
class NoProvider extends PaymentProvider {
  get name() { return 'none'; }
  isConfigured() { return false; }
}

const REGISTRY = {
  none: NoProvider,
  stripe: StripeProvider,
  epay: EPayProvider,
};

let instance = null;

function getProvider() {
  if (instance) return instance;
  const key = (process.env.PAYMENT_PROVIDER || 'none').toLowerCase();
  const Impl = REGISTRY[key];
  if (!Impl) {
    console.warn(`  !  Unknown PAYMENT_PROVIDER "${key}" — falling back to cash-only.`);
    console.warn(`     Valid values: ${Object.keys(REGISTRY).join(', ')}`);
    instance = new NoProvider();
  } else {
    instance = new Impl();
  }
  return instance;
}

/** True when the frontend should offer the card option at all. */
function cardPaymentsEnabled() {
  return getProvider().isConfigured();
}

module.exports = { getProvider, cardPaymentsEnabled, REGISTRY };
