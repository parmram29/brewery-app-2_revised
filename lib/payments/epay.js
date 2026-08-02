// ============================================================
// Republic Bank EPay provider — SKELETON, NOT YET FUNCTIONAL.
//
// ⚠️  Every value marked TODO(bank) must be filled in from Republic
//     Bank's merchant integration pack. They are deliberately left blank
//     rather than guessed: endpoint URLs, field names and — above all —
//     the signature scheme differ between gateways, and a plausible-looking
//     guess would produce code that runs, appears to work, and either
//     fails to take money or marks orders paid without verifying anything.
//
// Until it is completed, isConfigured() returns false, so the site simply
// offers cash on pickup/delivery and never shows a broken card option.
//
// WHAT TO GET FROM THE BANK
// -------------------------
//  1. Integration/API guide — endpoint URLs (sandbox + production) and the
//     exact request field names.
//  2. Merchant credentials — merchant id, and whatever secret is used to
//     sign requests. These go in .env, never in this file.
//  3. The signature/hash scheme — which fields are concatenated, in what
//     order, which algorithm (HMAC-SHA256? SHA-512? plain digest?), and
//     how it is encoded (hex or base64). This is the security-critical part.
//  4. The confirmation mechanism — is there a server-to-server callback
//     (like a webhook), or only a browser redirect back with query params?
//     This materially changes how safe the integration can be; see the note
//     on verifyCallback() below.
//  5. Currency and amount format — XCD code (numeric 951?) and whether the
//     amount is major units ("45.00") or minor units ("4500").
//  6. Sandbox/test credentials and test card numbers.
//
// Many Caribbean bank gateways are operated behind the scenes by a
// processor such as First Atlantic Commerce, in which case the bank's pack
// will point at that processor's API docs. Follow whatever the pack says —
// do not assume.
// ============================================================

const crypto = require('crypto');
const { PaymentProvider } = require('./provider');

class EPayProvider extends PaymentProvider {
  get name() { return 'epay'; }

  get callbackBodyFormat() {
    // TODO(bank): bank gateways commonly POST application/x-www-form-urlencoded
    // to the callback URL. Change to 'json' or 'raw' if the pack says otherwise.
    // If the signature is computed over the raw body bytes, this MUST be 'raw'.
    return 'form';
  }

  isConfigured() {
    return !!(process.env.EPAY_MERCHANT_ID && process.env.EPAY_SECRET && EPayProvider.IMPLEMENTED);
  }

  // Flip to true only once createCheckout and verifyCallback below are filled
  // in from the bank's documentation AND tested against their sandbox.
  static IMPLEMENTED = false;

  async createCheckout({ order, items, successUrl, cancelUrl }) {
    throw new Error(
      'Republic Bank EPay is not implemented yet — see lib/payments/epay.js. ' +
      'Use PAYMENT_PROVIDER=none to run cash-only in the meantime.'
    );

    /* ---------------------------------------------------------------
    IMPLEMENTATION SKETCH — adjust every name/URL to match the bank's pack.

    const amount = order.total_ec;                 // TODO(bank): major or minor units?
    const orderRef = order.order_ref;              // our unguessable reference

    // The signature usually covers merchant id + order ref + amount + currency,
    // concatenated in a documented order, hashed with a shared secret.
    // TODO(bank): confirm the exact field list, order, algorithm and encoding.
    const signature = crypto
      .createHmac('sha256', process.env.EPAY_SECRET)
      .update(`${process.env.EPAY_MERCHANT_ID}${orderRef}${amount}951`)
      .digest('hex');

    const params = new URLSearchParams({
      MerchantId:  process.env.EPAY_MERCHANT_ID,   // TODO(bank): real field names
      OrderId:     orderRef,
      Amount:      String(amount),
      Currency:    '951',                          // TODO(bank): confirm XCD code
      ReturnUrl:   successUrl,
      CancelUrl:   cancelUrl,
      Signature:   signature,
    });

    // Hosted-page gateways typically want the browser redirected to their URL
    // with these parameters; some instead want a server-side POST that returns
    // a one-time payment URL. TODO(bank): which model is this?
    return {
      redirectUrl: `${process.env.EPAY_CHECKOUT_URL}?${params}`,
      paymentRef:  orderRef,
    };
    --------------------------------------------------------------- */
  }

  async verifyCallback(req) {
    throw new Error('Republic Bank EPay callback verification is not implemented yet — see lib/payments/epay.js.');

    /* ---------------------------------------------------------------
    IMPLEMENTATION SKETCH.

    ⚠️  SECURITY: this function decides whether real money arrived. If the
        gateway only redirects the browser back (no server-to-server call),
        treat the redirect as a hint ONLY — never as proof of payment — and
        confirm by calling the bank's transaction-status/query API server-side
        before marking the order paid. A browser redirect can be replayed or
        forged by the customer; a signed server-to-server callback cannot.

    const body = req.body || {};
    const { OrderId, TransactionId, ResponseCode, Amount, Signature } = body; // TODO(bank)

    // Recompute the hash over the response fields the bank specifies and
    // compare in constant time. TODO(bank): exact fields, order, algorithm.
    const expected = crypto
      .createHmac('sha256', process.env.EPAY_SECRET)
      .update(`${OrderId}${TransactionId}${ResponseCode}${Amount}`)
      .digest('hex');

    if (!safeEqualHex(expected, Signature)) {
      return { verified: false, outcome: 'ignored', detail: 'signature mismatch' };
    }

    // TODO(bank): which ResponseCode means approved? '1'? '00'? 'APPROVED'?
    const approved = ResponseCode === '1';

    return {
      verified:   true,
      paymentRef: OrderId,
      outcome:    approved ? 'paid' : 'failed',
      detail:     TransactionId,
    };
    --------------------------------------------------------------- */
  }
}

/**
 * Constant-time hex comparison. Provider-agnostic and safe to keep: a plain
 * === on a signature leaks, through response timing, how many leading
 * characters were correct, which is enough to forge one byte at a time.
 */
function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { EPayProvider, safeEqualHex };
