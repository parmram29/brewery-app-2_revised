// ============================================================
// Payment provider contract.
//
// The routes in routes/payments.js know nothing about Republic Bank
// EPay, WiPay, or whatever comes next — they only know this interface.
// Swapping providers is a config change (PAYMENT_PROVIDER) plus one new
// file in this directory, not a rewrite of the ordering flow.
//
// Two rules every implementation must hold to, because they are what
// keep this application out of PCI DSS SAQ D scope and what stop an
// order being marked paid without money moving:
//
//   1. Card data never touches this server. A provider hands back a URL
//      the customer is redirected to; the card is entered on the
//      provider's page. No implementation may accept a PAN.
//
//   2. Only a *verified* server-side callback marks an order paid. The
//      browser returning to a "success" URL proves nothing — anyone can
//      visit that URL. verifyCallback() must cryptographically verify
//      the message really came from the provider before it is trusted.
// ============================================================

/**
 * @typedef {Object} CheckoutRequest
 * @property {Object} order      Row from `orders`
 * @property {Array}  items      Rows from `order_items`
 * @property {string} successUrl Where the customer lands after paying
 * @property {string} cancelUrl  Where the customer lands if they abandon
 *
 * @typedef {Object} CheckoutResult
 * @property {string} redirectUrl  Provider-hosted page to send the browser to
 * @property {string} paymentRef   Provider's id for this attempt, stored on the order
 *
 * @typedef {Object} CallbackResult
 * @property {boolean} verified    Did this genuinely come from the provider?
 * @property {string}  paymentRef  Which payment attempt it refers to
 * @property {'paid'|'failed'|'expired'|'ignored'} outcome
 * @property {string}  [detail]    Transaction id / reason, for the audit log
 */

const jwt = require('../jwt');

class PaymentProvider {
  /** Short machine name, stored on the order (e.g. 'epay', 'wipay'). */
  get name() { throw new Error('PaymentProvider.name not implemented'); }

  /** False when keys are absent — the app still boots and offers cash. */
  isConfigured() { return false; }

  /** @param {CheckoutRequest} _req @returns {Promise<CheckoutResult>} */
  async createCheckout(_req) {
    throw new Error(`${this.name}: createCheckout not implemented`);
  }

  /**
   * Verify and interpret a provider callback.
   * MUST return { verified: false } unless the payload's signature/hash
   * checks out. Never trust the request body alone.
   * @param {import('express').Request} _req @returns {Promise<CallbackResult>}
   */
  async verifyCallback(_req) {
    throw new Error(`${this.name}: verifyCallback not implemented`);
  }

  /**
   * Body parser this provider's callback route needs.
   * 'raw'  — signature is computed over the exact request bytes
   * 'form' — application/x-www-form-urlencoded POST (common for bank gateways)
   * 'json' — parsed JSON
   */
  get callbackBodyFormat() { return 'json'; }

  /**
   * Helper for gateways that authenticate API calls with a signed JWT
   * (`Authorization: Bearer <jwt>`) instead of a plain API key. Only use it
   * if the gateway's docs actually call for one — a gateway expecting a
   * static key will reject a JWT.
   *
   * Note what this does and does not do: it authenticates *our* call to the
   * gateway. It is not evidence a payment succeeded. Payment is confirmed
   * only by verifyCallback().
   *
   * @param {object} claims  e.g. { iss: merchantId, sub: orderRef, amount }
   * @param {string} secret  the gateway's signing secret, from .env
   * @param {number} [ttl]   seconds until expiry; short is correct for a
   *                         per-request token
   */
  signJwt(claims, secret, ttl = 300) {
    return jwt.sign(claims, secret, { expiresInSeconds: ttl });
  }

  /** Verify a JWT a gateway sent us. Returns claims, or null if invalid. */
  verifyJwt(token, secret) {
    return jwt.verify(token, secret);
  }
}

module.exports = { PaymentProvider };
