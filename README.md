# Sweet & Crispy — Order, Pay & Reserve

A family-run pizzeria & kitchen site for Grenada. Node/Express + MySQL backend,
vanilla ES-module frontend (no bundler, no framework — deliberately, for a
small single-location business this keeps the whole stack readable and cheap
to host). Stripe Checkout handles card payments; cash is settled on pickup
and confirmed by staff.

## Project layout

```
server.js              Express app: security headers, route mounting, static hosting
lib/security.js         makeRef() (unguessable order/reservation refs), rateLimit()
db/
  schema.sql             Full schema + seed data (56 menu items)
  pool.js                 mysql2 connection pool
routes/
  auth.js                 Staff PIN check
  menu.js                  Public menu list + staff show/hide toggle
  orders.js                 Cart → order creation, editing, status, cash payment confirmation
  payments.js                Stripe Checkout session creation + webhook handler
  reservations.js              Table booking + time-slot capacity logic
  specials.js                   "Today's Special" homepage feature
  sales.js                       Revenue/report queries for the staff dashboard
public/
  index.html               Markup only — no inline <style>/<script>, no onclick=""
  css/style.css             Full stylesheet, sectioned by page/component
  js/
    app.js                   Entry point — instantiates every service/page class and boots
    services/
      api-client.js           ApiClient class — one fetch() wrapper the whole app shares
      cart.js                   Cart class — cart state + behaviour, no DOM
      menu-store.js               MenuStore class — loads/holds the menu + payment config
      format.js                    money/date formatting + escapeHtml()
      whatsapp.js                   wa.me link builder
    ui/
      toast.js                  Toast class (wraps the #toast element)
      router.js                  Router class (page switching, nav highlighting)
      footer.js                   shared footer markup
    pages/
      home-page.js               HomePage class
      about-page.js                AboutPage class
      order-page.js                 OrderPage class — menu browsing, cart, checkout
      reserve-page.js                ReservePage class — table booking flow
      pay-page.js                     PayPage class — owns the Order/Reserve tab switch
      admin-page.js                    AdminPage class — staff dashboard
```

Everything under `public/js/` is a native ES module (`import`/`export`,
loaded via `<script type="module" src="/js/app.js">` — no bundler). Each
class only depends on what's passed into its constructor (an `ApiClient`, a
`MenuStore`, a `Cart`, a `Toast`), so any of them can be understood, tested,
or reused without the rest of the app. Every page class owns exactly one
container element and wires **one delegated event listener** on it — dynamic
content is rendered with `data-action="..."` attributes instead of inline
`onclick=""`, and the listener reads `event.target.closest('[data-action]')`
to dispatch. That pattern is what makes the strict `script-src 'self'` CSP
in `server.js` possible (see below).

## Local setup

```bash
cp .env.example .env        # fill in DB credentials, ADMIN_PIN, Stripe keys
mysql -u root -p < db/schema.sql
npm install
npm run dev                  # nodemon, or `npm start` for plain node
```

The app runs and serves the full frontend even without Stripe configured —
card payment attempts return a clear "not configured yet, choose cash"
message instead of failing silently (see `GET /api/payments/config`).

## Payments: how the security boundary actually works

- **Card payments never touch this server.** `POST /api/payments/checkout-session`
  creates a Stripe-hosted Checkout Session and returns its URL; the browser is
  redirected there directly. Card numbers are entered on Stripe's page. This
  keeps the app in PCI DSS **SAQ A** scope (the lightest self-assessment tier)
  instead of SAQ D, because we never receive, transmit, or store cardholder data.
- **Prices are never trusted from the client.** Every order line is re-priced
  from `menu_items` in `routes/orders.js::resolveCart()` before it's persisted
  or sent to Stripe. A tampered `fetch()` call claiming a $60 pizza costs $1
  is simply ignored — the server looks up the real price by `menu_item_id`.
- **Only the Stripe webhook marks a card order paid.** `routes/payments.js`
  verifies the `Stripe-Signature` header against `STRIPE_WEBHOOK_SECRET`
  before trusting an event — the success redirect the customer's browser
  hits is purely cosmetic and never itself flips `payment_status`. This
  closes the gap where someone could load the "payment successful" URL
  without having actually paid.
- **Cash orders** are marked paid only by staff, via `PATCH /api/orders/:id/payment`,
  which refuses to touch a `card` order (that field is Stripe-webhook-only).
- **Secrets** (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ADMIN_PIN`, DB
  credentials) live only in `.env`, which is git-ignored. The frontend only
  ever learns `cardPaymentsEnabled: boolean` from `/api/payments/config` —
  the secret key itself is constructed lazily server-side and never serialized
  to a response.

## Other security decisions worth knowing about

- **SQL injection**: every query uses `mysql2` parameterized placeholders
  (`?`), including the dynamic `IN (...)` list in `resolveCart()`, which is
  built with a matching number of `?` placeholders rather than string-interpolated.
- **Unguessable references**: order/reservation refs (`ORD-xxxx`, `RES-xxxx`)
  use `crypto.randomBytes` (`lib/security.js`), not sequential IDs, so one
  reference can't be used to enumerate/guess another customer's order.
- **Rate limiting**: order creation and checkout-session creation are
  rate-limited per IP (`lib/security.js::rateLimit`) to blunt scripted abuse.
  It's an in-memory fixed-window limiter — fine for a single-instance deploy;
  a multi-instance deployment would need a shared store (Redis) instead.
- **Stored-XSS defense**: customer-supplied text (name, phone, notes, special
  instructions) is rendered into the staff dashboard via `innerHTML`. Every
  such value is passed through `escapeHtml()` (`public/js/services/format.js`)
  before interpolation — see the comment there for why this matters.
- **CSP**: `script-src 'self'` with no `unsafe-inline` — real, not just
  documented as a trade-off — because the frontend has no inline event
  handlers left (see the event-delegation pattern above). `style-src` still
  allows `'unsafe-inline'` for one-off inline `style=""` layout tweaks in the
  markup, a much lower-severity allowance since CSS injection can't execute
  arbitrary JS. `frame-ancestors 'none'` blocks framing; no third-party
  script/font/connect origins are allowed beyond Google Fonts.
- **Request size limits**: JSON/urlencoded bodies are capped at 100kb.
- **Admin PIN gate**: intentionally a shared-PIN model (`routes/auth.js`),
  appropriate for one small team sharing one dashboard — not a
  multi-user/role permission system. If individual staff logins are ever
  needed, that's a session/JWT-based rework, not a client-side check.

## Menu data model

`menu_items.category` is `'pizza'` or `'food'` — the two ordering tabs.
`subcategory` groups items within a tab (e.g. "Stuffed Crust", "Burgers") and
drives the collapsible dropdown sections on the ordering page. Stuffed-crust
pizzas carry both `price_ec` (Medium) and `price_large_ec` (Large); everything
else has a single price. `order_items` snapshots `item_name`/`unit_price` (and
`special_instructions`) at order time, so a later menu price change never
rewrites history — `menu_item_id` is kept as a reference but order rows
survive a menu item being deleted (`ON DELETE SET NULL`).

## Deploying

1. Provision MySQL, run `db/schema.sql`.
2. Set real environment variables (see `.env.example`) — especially
   `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY`/`STRIPE_WEBHOOK_SECRET` from
   your Stripe dashboard, and `CLIENT_URL` set to your real domain (used to
   build the Stripe redirect URLs).
3. In the Stripe dashboard, add a webhook endpoint at
   `https://<your-domain>/api/payments/webhook` subscribed to
   `checkout.session.completed`, and copy its signing secret into
   `STRIPE_WEBHOOK_SECRET`.
4. Serve over HTTPS (required for both Stripe and for `helmet`'s HSTS header
   to mean anything) — terminate TLS at your load balancer/reverse proxy if
   Node isn't handling it directly.
