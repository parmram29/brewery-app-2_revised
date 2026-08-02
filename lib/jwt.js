// ============================================================
// Minimal HS256 JSON Web Tokens — no dependencies.
//
// Written against Node's crypto rather than pulling in jsonwebtoken: the
// signing half of JWT is about thirty lines, and a payments codebase is a
// bad place to add supply-chain surface for something this small.
//
// WHAT THIS IS FOR
//   Payment gateways that authenticate API calls with a signed JWT rather
//   than a plain API key (`Authorization: Bearer <jwt>`). A provider in
//   lib/payments/ can call sign() to mint one per request.
//
// WHAT THIS IS NOT FOR
//   Trusting a payment result. A JWT proves a message was signed by whoever
//   holds the key — it says nothing about whether money moved. Orders are
//   still marked paid only by a verified gateway callback.
//
// Only HS256 is implemented, and verify() requires it. Accepting the
// algorithm named in the token's own header is the classic JWT
// vulnerability: an attacker sets "alg":"none" and the token verifies with
// no signature at all. The algorithm is fixed here, not negotiated.
// ============================================================

const crypto = require('crypto');

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded + '='.repeat((4 - (padded.length % 4)) % 4), 'base64');
}

function signature(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Mint a signed token.
 * @param {object} payload  Claims. Never put secrets here — a JWT is signed,
 *                          not encrypted; anyone holding it can read it.
 * @param {string} secret
 * @param {{expiresInSeconds?: number}} [opts]
 */
function sign(payload, secret, opts = {}) {
  if (!secret) throw new Error('jwt.sign: secret is required');

  const now = Math.floor(Date.now() / 1000);
  const claims = { iat: now, ...payload };
  if (opts.expiresInSeconds) claims.exp = now + opts.expiresInSeconds;

  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const data = `${header}.${body}`;
  return `${data}.${signature(data, secret)}`;
}

/**
 * Verify and decode. Returns null on any failure rather than throwing, so a
 * malformed token from an untrusted source is never an unhandled exception.
 * @returns {object|null} the claims, or null if invalid/expired
 */
function verify(token, secret) {
  if (!secret || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, provided] = parts;

  let parsedHeader;
  try {
    parsedHeader = JSON.parse(b64urlDecode(header).toString('utf8'));
  } catch { return null; }

  // Reject anything not HS256 — never trust the token's own algorithm claim.
  if (!parsedHeader || parsedHeader.alg !== 'HS256') return null;

  const expected = signature(`${header}.${body}`, secret);

  // Constant-time compare: a plain === leaks, through response timing, how
  // many leading characters matched, which is enough to forge a signature
  // one character at a time.
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let claims;
  try {
    claims = JSON.parse(b64urlDecode(body).toString('utf8'));
  } catch { return null; }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === 'number' && now >= claims.exp) return null;
  if (typeof claims.nbf === 'number' && now < claims.nbf) return null;

  return claims;
}

/** Read claims WITHOUT verifying. Debugging only — never trust the result. */
function decodeUnsafe(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
  } catch { return null; }
}

module.exports = { sign, verify, decodeUnsafe };
