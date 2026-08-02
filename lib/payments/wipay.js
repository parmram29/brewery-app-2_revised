// ============================================================
// WiPay provider — SKELETON, NOT YET FUNCTIONAL.
//
// WiPay is a Caribbean payment gateway. Compared with going through a
// bank directly it is usually the faster route to accepting cards online,
// because merchant signup is self-service and the API is publicly
// documented — worth trying first if Republic Bank's merchant onboarding
// is slow.
//
// ⚠️  Every value marked TODO(wipay) must come from WiPay's current API
//     documentation for your account. They are left blank rather than
//     guessed: field names, the response-hash scheme and the exact
//     approval codes decide whether money actually arrives, and a
//     plausible-looking guess produces code that runs, looks correct, and
//     either fails to charge or marks orders paid without verifying.
//
// Until completed, isConfigured() returns false, so the site offers cash
// only and never shows a card button that fails.
//
// WHAT TO GET FROM WIPAY
// ----------------------
//  1. Account number / merchant id, and the API key or secret.
//  2. The request endpoint and its exact field names.
//  3. How payment is confirmed back to you — WiPay typically returns the
//     customer to your `response_url`. CRITICAL: establish whether there
//     is ALSO a server-to-server callback, and how to verify authenticity
//     (hash field, or a status-query endpoint you can call). See the
//     security note on verifyCallback().
//  4. Which status value means approved.
//  5. Currency support — confirm XCD is accepted for a Grenada account, or
//     whether settlement is in TTD/USD, and who bears the conversion.
//  6. The fee model, and whether "customer pays fee" is an option you want.
//  7. Sandbox credentials and test cards.
// ============================================================

const crypto = require('crypto');
const { PaymentProvider } = require('./provider');
const { safeEqualHex } = require('./epay');

class WiPayProvider extends PaymentProvider {
  get name() { return 'wipay'; }

  get callbackBodyFormat() {
    // TODO(wipay): confirm whether the confirmation arrives as a form POST,
    // JSON, or query parameters on the return redirect. If a hash is computed
    // over raw bytes, this must be 'raw'.
    return 'form';
  }

  isConfigured() {
    return !!(process.env.WIPAY_ACCOUNT_ID && process.env.WIPAY_API_KEY && WiPayProvider.IMPLEMENTED);
  }

  // Flip to true only once both methods below are filled in from WiPay's
  // documentation AND tested end-to-end against their sandbox.
  static IMPLEMENTED = false;

  async createCheckout({ order, items, successUrl, cancelUrl }) {
    throw new Error(
      'WiPay is not implemented yet — see lib/payments/wipay.js. ' +
      'Use PAYMENT_PROVIDER=none to run cash-only in the meantime.'
    );

    /* ---------------------------------------------------------------
    IMPLEMENTATION SKETCH — adjust every name/URL to WiPay's current docs.

    // WiPay's hosted flow generally takes a POST of transaction details and
    // returns a payment URL to redirect the browser to.
    // TODO(wipay): exact endpoint, field names, and amount format.
    const payload = {
      account_number: process.env.WIPAY_ACCOUNT_ID,
      total:          order.total_ec,          // TODO(wipay): major or minor units?
      currency:       'XCD',                   // TODO(wipay): supported for this account?
      order_id:       order.order_ref,         // our unguessable reference
      return_url:     successUrl,
      environment:    process.env.WIPAY_ENV || 'sandbox',
      // TODO(wipay): fee_structure / customer details / method fields as documented
    };

    const resp = await fetch(process.env.WIPAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.WIPAY_API_KEY}`,  // TODO(wipay): auth scheme
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(`WiPay returned ${resp.status}`);
    const data = await resp.json();

    return {
      redirectUrl: data.url,             // TODO(wipay): actual response field
      paymentRef:  order.order_ref,      // TODO(wipay): use their transaction id if returned
    };
    --------------------------------------------------------------- */
  }

  async verifyCallback(req) {
    throw new Error('WiPay callback verification is not implemented yet — see lib/payments/wipay.js.');

    /* ---------------------------------------------------------------
    IMPLEMENTATION SKETCH.

    ⚠️  SECURITY — READ BEFORE IMPLEMENTING.
        Gateways that confirm payment by redirecting the customer's BROWSER
        back to a response_url are not self-verifying: the customer controls
        that request and can replay or edit it. If WiPay provides a hash over
        the response fields, verify it. If it does not, you MUST confirm by
        calling WiPay's transaction-status endpoint server-side, using the
        order reference, and trust only that answer. Marking an order paid
        purely because a browser hit the return URL is how a site gives away
        food for free.

    const body = { ...req.query, ...req.body };
    const { order_id, transaction_id, status, hash } = body;  // TODO(wipay)

    // Option A — a documented response hash:
    const expected = crypto
      .createHash('md5')                       // TODO(wipay): algorithm per docs
      .update(`${order_id}${status}${process.env.WIPAY_API_KEY}`)  // TODO(wipay): field order
      .digest('hex');
    if (!safeEqualHex(expected, hash)) {
      return { verified: false, outcome: 'ignored', detail: 'hash mismatch' };
    }

    // Option B — no hash available: ignore `status` from the request entirely
    // and re-query WiPay server-side before trusting anything.

    // TODO(wipay): which value means approved — 'success'? '1'? 'APPROVED'?
    const approved = String(status).toLowerCase() === 'success';

    return {
      verified:   true,
      paymentRef: order_id,
      outcome:    approved ? 'paid' : 'failed',
      detail:     transaction_id,
    };
    --------------------------------------------------------------- */
  }
}

module.exports = { WiPayProvider };
