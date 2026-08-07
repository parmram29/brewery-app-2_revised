require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const path    = require('path');
const { assertAdminPinConfigured } = require('./lib/auth');
const { getProvider } = require('./lib/payments');
const { log } = require('./lib/log');

const app = express();

// Refuse to run with an unset or placeholder ADMIN_PIN rather than run with a
// dashboard "protected" by a value published in .env.example.
//
// On a normal long-lived process (local dev, a VPS) process.exit() is the
// right call — it fails loudly the moment someone starts the server. On a
// serverless platform (Vercel) this file is `require()`d fresh per request
// instead of run once; calling process.exit() there kills the entire
// function runtime and turns a config mistake into an opaque
// FUNCTION_INVOCATION_FAILED crash with no useful message. So on serverless,
// refuse every request with a clear error instead of exiting the process.
const adminPinConfigured = assertAdminPinConfigured();
if (!adminPinConfigured) {
  if (require.main === module) {
    process.exit(1);
  }
  app.use((req, res) => res.status(500).json({
    ok: false,
    error: 'Server misconfigured: ADMIN_PIN is not set, or is too weak. Set a real ADMIN_PIN (8+ characters) in your deployment’s environment variables.',
  }));
}

// Sets standard defensive headers (X-Content-Type-Options, X-Frame-Options,
// Referrer-Policy, HSTS, etc).
//
// The frontend (public/js/) is ES modules with event delegation — no inline
// onclick="" handlers anywhere — so script-src can stay at a strict 'self'
// with no 'unsafe-inline' needed. That makes CSP a real XSS backstop here,
// on top of (not instead of) output-encoding every customer-supplied value
// before it's interpolated into innerHTML (see escapeHtml() in
// public/js/services/format.js, used throughout the page classes).
// style-src still needs 'unsafe-inline': the markup uses inline style=""
// attributes for one-off layout tweaks. That's a much smaller risk than
// inline script would be — CSS injection can't execute arbitrary JS — and
// is left as-is rather than converting every inline style to a class.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));

app.disable('x-powered-by');

// Proxy trust must be explicit, because both defaults are wrong somewhere:
//   unset behind nginx/Cloudflare → req.ip is the proxy for every request, so
//     all customers share one rate-limit bucket and one abuser locks out the
//     whole restaurant.
//   set with no proxy in front    → X-Forwarded-For is attacker-controlled, so
//     every rate limit is bypassed by rotating a header value.
// Set TRUST_PROXY only when something really does sit in front of Node.
if (process.env.TRUST_PROXY) {
  // A number is the hop count; nginx on the same host is 1.
  const hops = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isFinite(hops) ? hops : process.env.TRUST_PROXY);
}

// Force HTTPS in production. Cookies carry the staff session and orders carry
// customer PII; both are readable on the wire over plain HTTP. Runs before
// anything else so no handler ever sees an unencrypted request.
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const proto = req.get('x-forwarded-proto') || req.protocol;
    if (proto !== 'https') {
      return res.redirect(308, `https://${req.get('host')}${req.originalUrl}`);
    }
    next();
  });
}

// CORS is closed by default. It used to reflect any origin, which combined with
// cookie auth would let any site call staff endpoints with the staff cookie
// attached. Same-origin requests from this server's own frontend need no CORS
// header at all; set CORS_ORIGIN only if a separate frontend host is added.
app.use(cors(process.env.CORS_ORIGIN
  ? { origin: process.env.CORS_ORIGIN, credentials: true }
  : { origin: false }));

// The payment callback's body parser depends on the active provider, and must
// be registered before the global express.json(). Signature schemes that hash
// the exact request bytes need the body unparsed; gateways that POST a form
// need urlencoded. Getting this wrong makes every callback fail
// verification, so it is driven off the provider rather than hard-coded.
// Body limits are explicit everywhere: an unbounded parser is a trivial
// memory-exhaustion DoS. A gateway callback is never larger than a few KB.
const callbackFormat = getProvider().callbackBodyFormat;
app.use('/api/payments/webhook',
  callbackFormat === 'raw'  ? express.raw({ type: '*/*', limit: '64kb' })
  : callbackFormat === 'form' ? express.urlencoded({ extended: false, limit: '64kb' })
  : express.json({ limit: '64kb' }));

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth',         require('./routes/auth'));
app.use('/api/menu',         require('./routes/menu'));
app.use('/api/specials',     require('./routes/specials'));
app.use('/api/orders',       require('./routes/orders'));
app.use('/api/payments',     require('./routes/payments'));
app.use('/api/sales',        require('./routes/sales'));
app.use('/api/reservations', require('./routes/reservations'));

app.get('/api/ping', (req, res) => res.json({ ok: true, message: 'Sweet & Crispy server running' }));

// Unknown /api/* paths must return JSON 404, not the SPA's index.html — a
// mistyped endpoint otherwise resolves as HTML and surfaces as a confusing
// JSON parse error in the browser instead of a clear 404.
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Central error handler — without this an async throw ends as a hung request.
//
// A10: the stack trace is logged server-side and never sent to the client.
// Leaking file paths, library versions and query fragments to an attacker
// hands them a map of the application for free.
app.use((err, req, res, next) => {
  log.error('unhandled_error', {
    message: err.message,
    path: req.originalUrl,
    method: req.method,
  });
  if (err.stack) console.error(err.stack);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, error: 'Something went wrong' });
});

// A crash mid-request leaves the process in an unknown state. Log loudly so
// it is alertable rather than a silent restart nobody notices.
process.on('unhandledRejection', (reason) => {
  log.error('unhandled_rejection', { message: reason?.message || String(reason) });
});
process.on('uncaughtException', (err) => {
  log.error('uncaught_exception', { message: err.message });
  console.error(err.stack);
  process.exit(1);
});

// Vercel's @vercel/node builder imports this file and calls the exported app
// directly per-request — it never runs this file as a standalone process, so
// app.listen() must only happen when server.js is actually executed with
// `node server.js` (local dev, or a normal host like a VPS).
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  ✓  Sweet & Crispy server running');
    console.log(`  ✓  Local:   http://localhost:${PORT}`);
    console.log(`  ✓  Network: http://<your-ip>:${PORT}`);
    console.log('');
  });
}

module.exports = app;
