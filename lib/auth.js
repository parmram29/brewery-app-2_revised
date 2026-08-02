// ============================================================
// Staff authentication — the authorization boundary.
//
// Every staff-only route is wrapped in requireStaff(). Before this
// existed the PIN was checked once by the browser and nothing on the
// server ever verified it again, so every "staff" endpoint was in
// practice public: anyone could read all customer names and phone
// numbers, change order status, or hide the menu.
//
// Model: PIN is exchanged once for an opaque random session token
// delivered as an HttpOnly cookie. Sessions live in memory with an
// 8-hour TTL, so a server restart signs staff out — acceptable for a
// single-instance deployment, and the reason a multi-instance
// deployment must move this to a shared store (Redis) instead.
// ============================================================

const crypto = require('crypto');

const COOKIE_NAME = 'sc_staff';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

/** token -> expiry timestamp */
const sessions = new Map();

function sweepExpired() {
  const now = Date.now();
  for (const [token, expires] of sessions) {
    if (expires <= now) sessions.delete(token);
  }
}

function createSession() {
  sweepExpired();
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

function isValidSession(token) {
  if (!token) return false;
  const expires = sessions.get(token);
  if (!expires) return false;
  if (expires <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

/**
 * Compare a submitted PIN against ADMIN_PIN in constant time.
 *
 * Both sides are hashed first so timingSafeEqual always receives equal-length
 * buffers — comparing raw strings of different lengths throws, and comparing
 * them with === leaks the length and the position of the first wrong character
 * through timing. A 4-digit PIN is small enough that this matters.
 *
 * Fails closed: an unset or placeholder ADMIN_PIN rejects every attempt.
 */
function verifyPin(submitted) {
  const expected = process.env.ADMIN_PIN;
  if (!expected || expected === 'change-me') return false;
  if (typeof submitted !== 'string' || !submitted) return false;

  const a = crypto.createHash('sha256').update(submitted).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Minimal cookie reader — avoids adding a cookie-parser dependency. */
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

function setSessionCookie(res, token) {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',                       // not readable from JavaScript, so XSS can't steal it
    'SameSite=Strict',                // not sent cross-site, which blocks CSRF on staff routes
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  // Secure requires HTTPS; omitting it in development keeps localhost working.
  if (process.env.NODE_ENV === 'production') attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

/** Express middleware: 401s unless the request carries a valid staff session. */
function requireStaff(req, res, next) {
  const token = readCookie(req, COOKIE_NAME);
  if (!isValidSession(token)) {
    return res.status(401).json({ ok: false, error: 'Staff sign-in required' });
  }
  req.staffToken = token;
  next();
}

/**
 * Boot-time gate. Refuses to start rather than run with a missing or default
 * PIN, which would otherwise mean the dashboard is protected by a value that
 * is published in .env.example.
 */
// Obvious values an attacker tries first. Not exhaustive — the length and
// rate limits do the real work — but it costs nothing to refuse these.
const WEAK_PINS = new Set([
  'change-me', 'changeme', 'password', 'admin', 'letmein',
  '0000', '1111', '1234', '12345', '123456', '111111', '000000',
  '654321', '121212', 'qwerty', 'abc123', 'sweetcrispy',
]);

function assertAdminPinConfigured() {
  const pin = process.env.ADMIN_PIN;

  if (!pin) {
    console.error('\n  ✗  ADMIN_PIN is not set.');
    console.error('     Set a real ADMIN_PIN in .env before starting the server.\n');
    return false;
  }
  if (WEAK_PINS.has(pin.toLowerCase())) {
    console.error('\n  ✗  ADMIN_PIN is a default or well-known value.');
    console.error('     Choose something an attacker would not guess first.\n');
    return false;
  }
  // 8 attempts / 15 min means a 4-digit PIN still falls in about two weeks of
  // unattended grinding. 8+ characters puts that far out of reach.
  if (pin.length < 8) {
    console.error('\n  ✗  ADMIN_PIN is too short — use at least 8 characters.');
    console.error('     A 4-digit PIN is brute-forceable within days even behind');
    console.error('     the login rate limit. Mix letters and digits.\n');
    return false;
  }
  if (/^\d+$/.test(pin)) {
    // Warn rather than refuse: digits-only is materially weaker, but a long
    // numeric PIN is a legitimate choice for a tablet in a kitchen.
    console.warn('\n  !  ADMIN_PIN is digits only — letters would strengthen it considerably.\n');
  }
  return true;
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_MS,
  createSession,
  destroySession,
  isValidSession,
  verifyPin,
  readCookie,
  setSessionCookie,
  clearSessionCookie,
  requireStaff,
  assertAdminPinConfigured,
};
