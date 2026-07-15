require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const path    = require('path');

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

app.use(cors());

// The Stripe webhook needs the raw request body to verify its signature, so it
// must be registered before the global express.json() parser.
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));

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
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ✓  Sweet & Crispy server running');
  console.log(`  ✓  Local:   http://localhost:${PORT}`);
  console.log(`  ✓  Network: http://<your-ip>:${PORT}`);
  console.log('');
});
