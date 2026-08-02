const crypto = require('crypto');
const { securityEvent } = require('./log');

/**
 * Unguessable order/reservation reference.
 *
 * This is a CAPABILITY TOKEN, not a display id: anyone holding it can read
 * that order via GET /api/orders/track/:ref. It was 4 bytes (32 bits), which
 * is brute-forceable — against ~10k live orders an attacker expects a hit
 * every ~430k guesses, i.e. minutes at any useful request rate. 8 bytes
 * (64 bits) puts that out of reach, and the track endpoint is rate limited
 * as defence in depth.
 *
 * 16 hex characters is still short enough to read over the phone.
 */
function makeRef(prefix) {
  const rand = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `${prefix}-${rand}`;
}

/**
 * Resolve the client address for rate limiting.
 *
 * Deliberately does NOT read X-Forwarded-For directly. Express only populates
 * req.ip from that header when `trust proxy` is set, and that setting is gated
 * on the TRUST_PROXY env var (see server.js). The two failure modes this
 * avoids:
 *   - trust proxy unset behind nginx  → every client shares the proxy's IP,
 *     so one abuser rate-limits the entire restaurant out of ordering.
 *   - trust proxy set with no proxy   → anyone spoofs X-Forwarded-For and
 *     bypasses every limit.
 */
function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * In-memory fixed-window rate limiter.
 *
 * Single-instance only: a multi-instance deployment needs a shared store
 * (Redis), otherwise the effective limit multiplies by the instance count.
 */
function rateLimit(bucket, max, windowMs, opts = {}) {
  const hits = new Map();
  let lastSweep = Date.now();

  return (req, res, next) => {
    const now = Date.now();

    // Sweep expired entries. Without this the Map grows once per unique
    // client address and is never reclaimed — a slow memory-exhaustion DoS
    // that needs nothing more than a botnet sending one request each.
    if (now - lastSweep > windowMs) {
      for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
      lastSweep = now;
    }

    const key = `${bucket}:${clientKey(req)}`;
    const entry = hits.get(key);

    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.start + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(Math.max(retryAfter, 1)));

      // A09: a limit that trips silently cannot be alerted on. Log the first
      // breach per window only, so an attacker cannot flood the log itself.
      if (entry.count === max + 1) {
        securityEvent('rate_limit_exceeded', {
          bucket,
          client: clientKey(req),
          path: req.originalUrl,
        });
      }

      return res.status(429).json({
        ok: false,
        error: opts.message || 'Too many requests — please wait a moment and try again.',
      });
    }

    next();
  };
}

module.exports = { makeRef, rateLimit, clientKey };
