# Sweet & Crispy

A family-run pizzeria & kitchen site for Grenada. Vanilla ES-module frontend
(no bundler, no framework — deliberately, for a small single-location business
this keeps the whole stack readable and cheap to host). No database, no
staff login, no card payment gateway: customers browse the menu, add to a
cart, and checkout opens a prefilled WhatsApp message to place the order.
Payment is cash on pickup, confirmed in person.

## How ordering actually works

There's no backend call in the checkout flow at all:

1. The menu is a static file (`public/js/data/menu.js`) shipped with the
   code, not loaded from a database. To change a price or add an item, edit
   that file and redeploy.
2. `public/js/config.js` holds the two things that used to be server
   environment variables: `WHATSAPP_NUMBER` (the business number orders go
   to) and `SHEET_WEBHOOK_URL` (see below).
3. Placing an order builds an order reference and message client-side, opens
   a `wa.me` link with the order prefilled so the customer sends it
   themselves, and — if `SHEET_WEBHOOK_URL` is set — also POSTs the order to
   a free Google Apps Script Web App that appends a row to a Google Sheet.
   That Sheet is the order log; there is no dashboard to log into.

## Setting up the order log (Google Sheet)

1. Create a Google Sheet.
2. Extensions → Apps Script → paste in `docs/order-log-apps-script.gs`.
3. Deploy → New deployment → type **Web app** → Execute as **Me** → Who has
   access **Anyone** (this has to be "Anyone," not "Anyone with Google
   account" — customers aren't signed into anything, so a login-gated
   deployment silently rejects every order).
4. Copy the Web app URL into `SHEET_WEBHOOK_URL` in `public/js/config.js`.
5. In the Sheet: Tools → Notification settings → turn on notifications for
   "Any changes are made" for a push notification on every new order.
6. Any time you edit the Apps Script code, you must **redeploy a new
   version** (Deploy → Manage deployments → pencil icon → New version) —
   saving alone does not update the live URL's behaviour.

This endpoint being public ("Anyone") is intentional and safe: it can only
append a row with the fields the script defines, never read the sheet back
or touch anything else in the Google account.

## Project layout

```
public/
  index.html            Markup only — no inline <style>/<script>, no onclick=""
  css/style.css          Full stylesheet, sectioned by page/component
  js/
    app.js                 Entry point — instantiates every service/page class and boots
    config.js               WHATSAPP_NUMBER + SHEET_WEBHOOK_URL — edit these, not env vars
    data/menu.js             The menu itself. Edit here, then redeploy.
    services/
      cart.js                  Cart class — cart state + behaviour, no DOM
      menu-store.js              Loads/holds the static menu
      order-ref.js                 Client-side order reference generator
      format.js                     money/date formatting + escapeHtml()
      whatsapp.js                    wa.me link builder
    ui/
      toast.js                 Toast class (wraps the #toast element)
      router.js                 Router class (page switching, nav highlighting)
      footer.js                  shared footer markup
    pages/
      home-page.js              HomePage class
      about-page.js               AboutPage class
      order-page.js                OrderPage class — menu browsing, cart, checkout
      pay-page.js                   PayPage class — bootstraps the Order tab
docs/
  order-log-apps-script.gs   Paste-in script for the Google Sheet order log
```

Everything under `public/js/` is a native ES module (`import`/`export`,
loaded via `<script type="module" src="/js/app.js">` — no bundler). Each
class only depends on what's passed into its constructor, so any of them can
be understood, tested, or reused without the rest of the app. Every page
class owns exactly one container element and wires **one delegated event
listener** on it — dynamic content is rendered with `data-action="..."`
attributes instead of inline `onclick=""`.

## The legacy backend (server.js, routes/, lib/, db/)

These files still exist but are **unreachable dead code** — nothing in the
frontend calls them anymore. They're artifacts of an earlier version of this
site that had a MySQL-backed database, online card payments, and a
PIN-gated Staff dashboard for managing live orders. All of that was removed
in favor of the static-menu + WhatsApp + Google Sheet approach above, because
running a small hosted database reliably turned out to be more operational
overhead than this business needs.

They're left in place for now rather than deleted immediately, and are
slated for full removal in a later pass — at which point this becomes a
100% static site with no server, no database, and can move off Vercel to
free static hosting (GitHub Pages, Cloudflare Pages, etc.) entirely.

## Local preview

No build step, no server required to just look at the site:

```bash
npx serve public
```

or open `public/index.html` directly in a browser. If you do want to run
`server.js` (mainly useful only for testing the legacy `/api/*` routes,
which nothing in the UI calls), `npm install && npm start`.

## Deploying

Currently hosted on Vercel as a staging/demo URL — `vercel.json` still
routes `/api/*` to `server.js` and everything else as static files from
`public/`, though the API side is unused. Moving to a plain static host is
the planned next step; when that happens `vercel.json`, `server.js`,
`routes/`, `lib/`, and `db/` all go away and `public/` becomes the entire
deployment.
