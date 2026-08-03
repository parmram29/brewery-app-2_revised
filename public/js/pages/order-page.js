import { money, escapeHtml } from '../services/format.js';
import { waLink } from '../services/whatsapp.js';
import { Cart } from '../services/cart.js';

/**
 * Menu browsing (Pizza / Food tabs, subcategory dropdowns) + cart +
 * checkout (hosted gateway page for card, or cash on pickup).
 *
 * Security note: the cart is UI state only. The server (routes/orders.js)
 * re-resolves every item's price and name from the database when the order
 * is created — nothing priced here is ever trusted directly.
 */
export class OrderPage {
  constructor({ api, menuStore, cart, toast }) {
    this.api = api;
    this.menuStore = menuStore;
    this.cart = cart;
    this.toast = toast;
    this.root = document.getElementById('order-content');

    this.category = 'pizza';
    this.subcategory = null;          // active chip filter, or null for "All"
    this.expandedSubcats = new Set(); // open dropdowns when viewing "All"
    this.sizeChoice = {};             // menu_item_id -> 'M' | 'L'
    this.payMethod = 'card';
    this.noteEditorKey = null;        // cart line key currently showing its textarea

    this.root.addEventListener('click', (e) => this.handleClick(e));
    this.root.addEventListener('input', (e) => this.handleInput(e));
    this.root.addEventListener('focusout', (e) => this.handleFocusOut(e));
  }

  render() { this.renderContent(); }

  // ── Event delegation ─────────────────────────────────────────
  handleClick(e) {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const { action, id, size, sub, key, delta, method } = t.dataset;
    switch (action) {
      case 'retry-menu':     this.retryMenu(); break;
      case 'set-cat':        this.setCategory(t.dataset.cat); break;
      case 'set-subcat':     this.setSubcategory(sub === '__all__' ? null : sub); break;
      case 'toggle-subcat':  this.toggleSubcatSection(sub); break;
      case 'pick-size':      this.pickSize(parseInt(id), size); break;
      case 'add-to-cart':    this.addToCart(parseInt(id)); break;
      case 'change-qty':     this.changeQty(key, parseInt(delta)); break;
      case 'remove-line':    this.cart.remove(key); this.renderContent(); break;
      case 'toggle-note':    this.toggleNoteEditor(key); break;
      case 'set-pay-method': this.setPayMethod(method); break;
      case 'place-order':    this.placeOrder(); break;
      case 'new-order':      this.renderContent(); break;
    }
  }

  handleInput(e) {
    if (e.target.matches('.cl-note-input')) {
      this.cart.setNote(e.target.dataset.key, e.target.value);
    }
  }

  handleFocusOut(e) {
    if (e.target.matches('.cl-note-input')) this.toggleNoteEditor(e.target.dataset.key);
  }

  // ── State transitions ────────────────────────────────────────
  setCategory(cat) { this.category = cat; this.subcategory = null; this.expandedSubcats = new Set(); this.renderContent(); }

  async retryMenu() {
    this.menuStore.loadError = null;
    await this.menuStore.load();
    this.renderContent();
  }

  // Selecting a chip filters straight to that subcategory (and counts as "expanded").
  // Selecting "All" collapses back into the dropdown view instead of dumping every
  // item on screen at once — the full 56-item menu was overwhelming as a flat list.
  setSubcategory(sub) {
    this.subcategory = this.subcategory === sub ? null : sub;
    if (this.subcategory) this.expandedSubcats.add(this.subcategory);
    this.renderContent();
  }

  toggleSubcatSection(sub) {
    if (this.expandedSubcats.has(sub)) this.expandedSubcats.delete(sub);
    else this.expandedSubcats.add(sub);
    this.renderContent();
  }

  pickSize(id, size) { this.sizeChoice[id] = size; this.renderContent(); }

  addToCart(id) {
    const item = this.menuStore.byId(id);
    if (!item) return;
    const size = item.price_large_ec != null ? (this.sizeChoice[id] || 'M') : null;
    this.cart.add(item, size);
    this.renderContent();
  }

  changeQty(key, delta) { this.cart.changeQuantity(key, delta); this.renderContent(); }

  toggleNoteEditor(key) {
    const opening = this.noteEditorKey !== key;
    this.noteEditorKey = opening ? key : null;
    this.renderContent();
    if (opening) {
      const ta = this.root.querySelector('.cl-note-input');
      if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
    }
  }

  setPayMethod(m) { this.payMethod = m; this.renderContent(); }

  // ── Rendering ─────────────────────────────────────────────────
  renderContent() {
    const cats = [{ id: 'pizza', label: '🍕 Pizza' }, { id: 'food', label: '🍽 Food' }];
    const inCat = this.menuStore.byCategory(this.category);
    const subcats = this.menuStore.subcategoriesOf(this.category);
    const shown = this.subcategory ? inCat.filter(i => i.subcategory === this.subcategory) : inCat;

    const groups = {};
    shown.forEach(i => { (groups[i.subcategory] = groups[i.subcategory] || []).push(i); });

    const itemsHtml = Object.keys(groups).length
      ? Object.entries(groups).map(([sub, items]) => {
          const open = this.subcategory === sub || this.expandedSubcats.has(sub);
          return `
          <div class="menu-sub-head${open ? ' open' : ''}" data-action="toggle-subcat" data-sub="${sub}">
            <span>${sub}</span>
            <span class="sub-meta">${items.length} item${items.length > 1 ? 's' : ''} <span class="chevron">▾</span></span>
          </div>
          ${open ? `<div class="subcat-body">${items.map(i => this.renderItemRow(i)).join('')}</div>` : ''}
        `;
        }).join('')
      : this.menuStore.loadError
        ? `<div style="padding:2rem 0;color:var(--ink-soft)">
             <p style="margin-bottom:1rem">${escapeHtml(this.menuStore.loadError)}</p>
             <button class="btn btn-outline btn-sm" data-action="retry-menu">Try Again</button>
           </div>`
        : '<p style="color:var(--ink-dim);padding:2rem 0">Loading menu…</p>';

    this.root.innerHTML = `
      <div class="order-cats">${cats.map(c => `<button class="order-cat-btn${this.category === c.id ? ' on' : ''}" data-action="set-cat" data-cat="${c.id}">${c.label}</button>`).join('')}</div>
      <div class="subcat-chips">
        <button class="subcat-chip${!this.subcategory ? ' on' : ''}" data-action="set-subcat" data-sub="__all__">All</button>
        ${subcats.map(s => `<button class="subcat-chip${this.subcategory === s ? ' on' : ''}" data-action="set-subcat" data-sub="${s}">${s}</button>`).join('')}
      </div>
      <div class="order-layout">
        <div>${itemsHtml}</div>
        ${this.renderCartPanel()}
      </div>`;
  }

  renderItemRow(i) {
    const hasSize = i.price_large_ec != null;
    const size = hasSize ? (this.sizeChoice[i.id] || 'M') : null;
    const qty = this.cart.quantityOf(i.id, size);
    const priceLabel = hasSize ? `${money(i.price_ec)} (M) · ${money(i.price_large_ec)} (L)` : money(i.price_ec);
    const key = Cart.keyFor(i.id, size);
    return `
      <div class="item-row">
        <div class="item-info">
          <h4>${i.name}${i.is_signature ? ' <span class="star">★</span>' : ''}</h4>
          <p>${i.description || ''}</p>
          <div class="item-price">${priceLabel}</div>
        </div>
        <div class="item-actions">
          ${hasSize ? `
          <div class="size-toggle">
            <button class="size-btn${size === 'M' ? ' on' : ''}" data-action="pick-size" data-id="${i.id}" data-size="M">M</button>
            <button class="size-btn${size === 'L' ? ' on' : ''}" data-action="pick-size" data-id="${i.id}" data-size="L">L</button>
          </div>` : ''}
          ${qty > 0 ? `
          <div class="qty-stepper">
            <button data-action="change-qty" data-key="${key}" data-delta="-1">−</button>
            <span class="qn">${qty}</span>
            <button data-action="change-qty" data-key="${key}" data-delta="1">+</button>
          </div>` : `<button class="add-btn" data-action="add-to-cart" data-id="${i.id}">Add</button>`}
        </div>
      </div>`;
  }

  renderCartPanel() {
    const { cart } = this;
    // With no card gateway live there is exactly one way to pay, so the
    // selection is forced rather than left on its 'card' default. Without
    // this the hidden tile could still submit payment_method:'card' and the
    // order would sit unpaid waiting for a checkout that can never start.
    if (!this.menuStore.cardPaymentsEnabled) this.payMethod = 'cash';
    return `
    <div class="cart-panel">
      <h3>Your Order</h3>
      <div class="sub">${cart.isEmpty ? 'Nothing added yet' : cart.itemCount + ' item(s)'}</div>
      ${cart.isEmpty ? '<div class="cart-empty">Add something delicious from the menu to get started.</div>' : `
      ${cart.lines.map(c => `
        <div class="cart-line-wrap">
          <div class="cart-line">
            <div>
              <div class="cl-name">${escapeHtml(c.item_name)}${c.size ? ` <span class="cl-size">(${c.size})</span>` : ''}</div>
              <div class="cl-price">${money(c.unit_price)} × ${c.quantity}</div>
              <button class="cl-note-toggle" data-action="toggle-note" data-key="${c.key}">${c.special_instructions ? '✎ ' + escapeHtml(c.special_instructions) : '+ Special instructions'}</button>
            </div>
            <div class="cl-controls">
              <button data-action="change-qty" data-key="${c.key}" data-delta="-1">−</button>
              <span class="qn">${c.quantity}</span>
              <button data-action="change-qty" data-key="${c.key}" data-delta="1">+</button>
              <button class="cl-remove" data-action="remove-line" data-key="${c.key}" title="Remove">×</button>
            </div>
          </div>
          ${this.noteEditorKey === c.key ? `
          <textarea class="cl-note-input" data-key="${c.key}" placeholder="e.g. no onions, extra sauce on the side…">${escapeHtml(c.special_instructions || '')}</textarea>` : ''}
        </div>`).join('')}
      <div class="cart-subtotal"><span>Subtotal</span><span>${money(cart.subtotal)}</span></div>
      <div class="field"><label>Your Name</label><input id="ord-name" placeholder="First &amp; last name"></div>
      <div class="field"><label>Phone</label><input id="ord-phone" type="tel" placeholder="+1 (473) …"></div>
      <div class="field"><label>Notes (optional)</label><textarea id="ord-notes" placeholder="Allergies, extra sauce, pickup time…"></textarea></div>
      <label style="display:block;font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-dim);margin-bottom:.35rem;font-weight:600">Payment</label>
      ${this.menuStore.cardPaymentsEnabled ? `
      <div class="pay-method-row">
        <button type="button" class="pm-btn${this.payMethod === 'card' ? ' on' : ''}" data-action="set-pay-method" data-method="card" aria-pressed="${this.payMethod === 'card'}"><span class="pm-icon">💳</span>Pay by Card</button>
        <button type="button" class="pm-btn${this.payMethod === 'cash' ? ' on' : ''}" data-action="set-pay-method" data-method="cash" aria-pressed="${this.payMethod === 'cash'}"><span class="pm-icon">💵</span>Pay by Cash</button>
      </div>` : `
      <!-- No card gateway is live, so the card tile is hidden rather than shown
           and then explained away. It returns automatically the moment a
           provider is configured — nothing here needs editing. -->
      <div class="pay-single">
        <span class="pm-icon">💵</span>
        <div>
          <strong>Pay with cash on pickup</strong>
          <div class="pay-single-sub">Have ${money(cart.subtotal)} ready when you collect. We'll confirm your order by WhatsApp.</div>
        </div>
      </div>`}
      <button class="btn btn-fill btn-block" id="place-order-btn" data-action="place-order">Place Order — ${money(cart.subtotal)}</button>
      `}
    </div>`;
  }

  // ── Checkout ──────────────────────────────────────────────────
  async placeOrder() {
    const name = document.getElementById('ord-name')?.value.trim();
    const phone = document.getElementById('ord-phone')?.value.trim();
    const notes = document.getElementById('ord-notes')?.value.trim();
    if (this.cart.isEmpty) { this.toast.show('Your cart is empty', 'err'); return; }
    if (!name) { this.toast.show('Please enter your name', 'err'); return; }
    if (!phone) { this.toast.show('Please enter a phone number', 'err'); return; }
    if (this.payMethod === 'card' && !this.menuStore.cardPaymentsEnabled) {
      this.toast.show('Card payments are not set up yet — please choose cash', 'err'); return;
    }

    const btn = document.getElementById('place-order-btn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Placing order…';

    const res = await this.api.post('/api/orders', {
      customer_name: name, phone, notes, items: this.cart.toOrderItems(), payment_method: this.payMethod,
    });
    if (!res.ok) { this.toast.show(res.error, 'err'); btn.disabled = false; btn.textContent = 'Place Order'; return; }

    const order = res.order;
    if (this.payMethod === 'cash') {
      this.cart.clear();
      this.showOrderSuccess(order, 'cash');
      return;
    }

    const sessionRes = await this.api.post('/api/payments/checkout-session', { order_ref: order.order_ref });
    if (!sessionRes.ok) { this.toast.show(sessionRes.error, 'err'); btn.disabled = false; btn.textContent = 'Place Order'; return; }
    this.cart.clear();
    window.location.href = sessionRes.url;
  }

  showOrderSuccess(order, method) {
    this.root.innerHTML = `
      <div class="order-success">
        <h2>Order Received! 🎉</h2>
        <div class="order-ref">${escapeHtml(order.order_ref)}</div>
        <p>${method === 'cash'
          ? `Thanks${order.customer_name ? ', ' + escapeHtml(order.customer_name) : ''}! Have <strong>${money(order.total_ec)}</strong> ready when you collect — we'll confirm your payment at pickup.`
          : `Thanks! Your payment of ${money(order.total_ec)} is confirmed.`}</p>
        <p style="font-size:.85rem">Keep this reference handy — it's how we find your order.</p>
        <p>We'll message you on WhatsApp if we need anything — feel free to reach out too.</p>
        <div style="display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap;margin-top:1rem">
          <a class="btn btn-olive" href="${waLink(this.menuStore.whatsapp, 'Hi! Just placed order ' + order.order_ref)}" target="_blank" rel="noopener">Message Us on WhatsApp</a>
          <button class="btn btn-outline" data-action="new-order">Start a New Order</button>
        </div>
      </div>`;
  }

  /**
   * Handles the redirect back from the gateway. Success/cancel state is
   * carried in the URL (?paid=1&ref=... / ?paycancelled=1&ref=...) — the
   * actual payment confirmation already happened server-side via the
   * webhook, this just reflects that back to the customer.
   */
  async handlePaymentReturn(router) {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (params.get('paid') && ref) {
      const res = await this.api.get('/api/orders/track/' + encodeURIComponent(ref));
      router.goTo('pay', { section: 'order' });
      if (res.ok) {
        setTimeout(() => this.showOrderSuccess({ order_ref: res.order.order_ref, customer_name: '', total_ec: res.order.total_ec }, 'card'), 50);
      }
      this.toast.show('Payment confirmed — thank you!', 'ok');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('paycancelled') && ref) {
      this.toast.show(`Payment cancelled. Your order ${ref} is saved — try again or message us to pay by cash.`, 'err');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }
}
