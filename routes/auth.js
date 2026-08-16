const router = require('express').Router();
const { rateLimit, clientKey } = require('../lib/security');
const { securityEvent } = require('../lib/log');
const {
  COOKIE_NAME, createSession, destroySession, isValidSession,
  verifyPin, readCookie, setSessionCookie, clearSessionCookie,
} = require('../lib/auth');

// POST /api/auth/login — exchange the staff PIN for a session cookie.
//
// Rate limited because a short PIN is otherwise brute-forceable in seconds:
// 10,000 combinations for 4 digits is minutes of scripted requests without
// a limit. 8 attempts per 15 minutes per IP makes that impractical.
router.post('/login', rateLimit('staff-login', 8, 15 * 60 * 1000), async (req, res) => {
  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ ok: false, error: 'PIN required' });

  if (!verifyPin(pin)) {
    // A09: without this a failed login left no trace anywhere, so someone
    // could grind the PIN indefinitely and be invisible. Alert on this event.
    securityEvent('auth_failed', { client: clientKey(req) });
    return res.status(401).json({ ok: false, error: 'Incorrect PIN' });
  }

  const token = await createSession();
  setSessionCookie(res, token);
  securityEvent('auth_success', { client: clientKey(req) });
  res.json({ ok: true });
});

// POST /api/auth/logout — destroy the session server-side, not just client-side.
router.post('/logout', async (req, res) => {
  await destroySession(readCookie(req, COOKIE_NAME));
  clearSessionCookie(res);
  res.json({ ok: true });
});

// GET /api/auth/session — lets the dashboard restore itself after a refresh
// without re-prompting, and detect an expired session.
router.get('/session', async (req, res) => {
  res.json({ ok: true, authenticated: await isValidSession(readCookie(req, COOKIE_NAME)) });
});

module.exports = router;
