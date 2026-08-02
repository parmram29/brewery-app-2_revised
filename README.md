# Sweet & Crispy — Order, Pay & Reserve

A family-run pizzeria & kitchen site for Grenada. Node/Express + MySQL backend,
vanilla ES-module frontend (no bundler, no framework — deliberately, for a
small single-location business this keeps the whole stack readable and cheap
to host). Card payments go through a Caribbean gateway (Republic Bank EPay
or WiPay); cash is settled on pickup
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
  payments.js                Gateway-agnostic checkout + verified payment callback
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
cp .env.example .env        # fill in DB credentials, ADMIN_PIN, gateway keys
mysql -u root -p < db/schema.sql
npm install
npm run dev                  # nodemon, or `npm start` for plain node
```

The app runs and serves the full frontend even without a card gateway configured —
card payment attempts return a clear "not configured yet, choose cash"
message instead of failing silently (see `GET /api/payments/config`).

## Payments: how the security boundary actually works

Card payments go through a **provider abstraction** (`lib/payments/`), so the
gateway is a config choice rather than something baked through the codebase:

```
PAYMENT_PROVIDER=none    cash only (default) — the card option never appears
PAYMENT_PROVIDER=epay    Republic Bank EPay  — lib/payments/epay.js
PAYMENT_PROVIDER=wipay   WiPay               — lib/payments/wipay.js
```

Both gateway files are **skeletons**: the structure, security properties and
audit logging are done, but every gateway-specific value (endpoint URLs, field
names, signature scheme) is marked `TODO`. Those are deliberately not guessed —
a plausible-looking guess yields code that runs, looks correct, and either fails
to charge or marks orders paid without verifying anything. Until one is
completed, `isConfigured()` returns false and the site quietly stays cash-only.

**Card brands vs. gateway.** Accepting Visa and Mastercard is a property of your
merchant account, not of this code. Whichever gateway is configured handles the
brands your account supports; nothing here changes per brand.

**Apple Pay / Google Pay** are wallet buttons that appear on the *gateway's*
hosted payment page when your merchant account has them enabled. They are not
implemented here and do not need to be — there is no code to write, only a
setting to switch on with the gateway. Two caveats worth knowing:

- Apple Pay requires **domain verification**: Apple issues a file that must be
  served at `/.well-known/apple-developer-merchantid-domain-association` on your
  real domain. `public/.well-known/` is already served as static content, so
  dropping the file there is all that is needed.
- Both require **HTTPS**. They will not appear over plain HTTP.

**JWT** (`lib/jwt.js`) is available for gateways that authenticate API calls with
a signed token rather than a static key — `provider.signJwt(claims, secret)`.
It is dependency-free HS256 and fixes the algorithm rather than reading it from
the token header, which is the standard JWT bypass (`alg:none`). Use it only if
your gateway's docs call for it. Note that a JWT authenticates *our request to
the gateway*; it is never evidence that a payment succeeded.

**"Sign in with Apple/Google"** is a different thing again — customer accounts,
not payments. This site deliberately has no customer accounts: an order needs a
name and a phone number, nothing more, which is one less credential to breach.

Whatever the gateway, these properties are enforced by the provider contract:

- **Card details never touch this server.** A provider returns a URL on the
  gateway's own hosted page and the browser is redirected there. Nothing in this
  codebase accepts a card number, and no column exists that could store one.
  That keeps the app in PCI DSS **SAQ A** scope instead of SAQ D.
- **Prices are never trusted from the client.** Every line is re-priced from
  `menu_items` in `routes/orders.js::resolveCart()` before it is persisted or
  sent to the gateway. A tampered `fetch()` claiming a $60 pizza costs $1 is
  ignored — the server looks up the real price by `menu_item_id`.
- **Only a verified callback marks a card order paid.** The customer's browser
  landing on the success URL is cosmetic; anyone can visit that URL without
  paying. `verifyCallback()` must cryptographically verify the message came from
  the gateway before it is trusted. If a gateway only redirects the browser back
  with no signed server-to-server call, that redirect must be treated as a hint
  and confirmed by querying the gateway's status API server-side.
- **Orders are frozen once payment starts.** `PATCH /api/orders/:id/items` is
  staff-only and refuses with 409 once `payment_ref` is set, closing the
  "pay for a cheap basket, receive an expensive one" hole.
- **Cash orders** are marked paid only by staff via `PATCH /api/orders/:id/payment`,
  which refuses to touch a `card` order. `payment_method` cannot be changed after
  creation, so a card order cannot be relabelled cash and then marked paid.
- **Every payment event is logged** to the append-only `payment_events` table —
  amounts, methods, gateway references, timestamps. Metadata only, never card data.
- **Secrets** (gateway keys, `ADMIN_PIN`, DB credentials) live only in `.env`,
  which is git-ignored. The frontend only ever learns `cardPaymentsEnabled: boolean`.

## Staff authentication — the authorization boundary

`POST /api/auth/login` exchanges the staff PIN for an opaque session token
delivered as an `HttpOnly; SameSite=Strict` cookie; every staff-only route is
wrapped in `requireStaff` (`lib/auth.js`) and returns 401 without it. Sessions
live in memory with an 8-hour TTL, so a restart signs staff out — acceptable for
a single-instance deployment, and the reason a multi-instance deployment must
move this to a shared store.

Also enforced here: constant-time PIN comparison, login rate limiting (8 attempts
/ 15 min — a short PIN is otherwise brute-forceable in minutes), server-side
session destruction on logout, and a boot-time refusal to start with a missing or
placeholder `ADMIN_PIN`.

**Public by design:** the menu, specials, order creation, and
`GET /api/orders/track/:ref` (the unguessable reference is the capability).
**Everything else is staff-only.**

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
2. Set real environment variables (see `.env.example`) — especially `ADMIN_PIN`
   (the server refuses to start without a real one) and `CLIENT_URL` set to your
   real domain, which is used to build the gateway redirect URLs.
3. To take card payments, complete the provider file for your gateway
   (`lib/payments/epay.js` or `lib/payments/wipay.js`) from their integration
   docs, set `PAYMENT_PROVIDER` and the matching keys, flip that provider's
   `IMPLEMENTED` flag, and test against their sandbox before going live.
   Until then the site runs cash-only, which is a perfectly valid way to launch.
4. Register your callback URL with the gateway as
   `https://<your-domain>/api/payments/webhook`.
5. Serve over HTTPS — required by any gateway, and for `helmet`'s HSTS header and
   the `Secure` session cookie to mean anything. Terminate TLS at your load
   balancer/reverse proxy if Node isn't handling it directly.
