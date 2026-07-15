const crypto = require('crypto');

// Unguessable order/reservation reference (not a sequential/guessable ID).
function makeRef(prefix) {
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${rand}`;
}

// Minimal in-memory fixed-window rate limiter for sensitive write endpoints
// (order creation, checkout session creation). Keyed by IP + bucket name.
function rateLimit(bucket, max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const key = bucket + ':' + (req.ip || req.socket.remoteAddress || 'unknown');
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ ok: false, error: 'Too many requests — please wait a moment and try again.' });
    }
    next();
  };
}

module.exports = { makeRef, rateLimit };
