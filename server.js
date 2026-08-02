require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const path    = require('path');
const { assertAdminPinConfigured } = require('./lib/auth');
const { getProvider } = require('./lib/payments');

const app = express();

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
const callbackFormat = getProvider().callbackBodyFormat;
app.use('/api/payments/webhook',
  callbackFormat === 'raw'  ? express.raw({ type: '*/*' })
  : callbackFormat === 'form' ? express.urlencoded({ extended: false })
  : express.json());

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
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, error: 'Something went wrong' });
});

// Refuse to boot with an unset or placeholder ADMIN_PIN rather than run with a
// dashboard "protected" by a value published in .env.example.
if (!assertAdminPinConfigured()) process.exit(1);

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ✓  Sweet & Crispy server running');
  console.log(`  ✓  Local:   http://localhost:${PORT}`);
  console.log(`  ✓  Network: http://<your-ip>:${PORT}`);
  console.log('');
});
