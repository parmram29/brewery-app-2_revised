import { money, escapeHtml } from '../services/format.js';
import { waLink } from '../services/whatsapp.js';
import { Cart } from '../services/cart.js';
import { makeOrderRef } from '../services/order-ref.js';
import { SHEET_WEBHOOK_URL } from '../config.js';

/**
 * Menu browsing (Pizza / Food tabs, subcategory dropdowns) + cart +
 * checkout. No backend involved: placing an order builds a WhatsApp
 * message from the cart and (optionally) logs the order to a Google
 * Sheet — cash on pickup is the only payment method, confirmed in person.
 */
export class OrderPage {
  constructor({ menuStore, cart, toast }) {
    this.menuStore = menuStore;
    this.cart = cart;
    this.toast = toast;
    this.root = document.getElementById('order-content');

    this.category = 'pizza';
    this.subcategory = null;          // active chip filter, or null for "All"
    this.expandedSubcats = new Set(); // open dropdowns when viewing "All"
    this.sizeChoice = {};             // menu_item_id -> 'M' | 'L'
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
    const { action, id, size, sub, key, delta } = t.dataset;
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
      <div class="pay-single">
        <span class="pm-icon">💵</span>
        <div>
          <strong>Pay with cash on pickup</strong>
          <div class="pay-single-sub">Have ${money(cart.subtotal)} ready when you collect. Placing your order opens WhatsApp so we can confirm it.</div>
        </div>
      </div>
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

    const order = {
      order_ref: makeOrderRef(),
      customer_name: name,
      phone,
      notes,
      items: this.cart.lines.map(l => ({
        item_name: l.item_name, size: l.size, unit_price: l.unit_price,
        quantity: l.quantity, special_instructions: l.special_instructions,
      })),
      total_ec: this.cart.subtotal,
      created_at: new Date().toISOString(),
    };

    // Best-effort order log — never blocks checkout. A customer's order must
    // never fail just because the spreadsheet couldn't be reached.
    this.logOrderToSheet(order);

    this.cart.clear();
    this.showOrderSuccess(order);
  }

  logOrderToSheet(order) {
    if (!SHEET_WEBHOOK_URL) return;
    // mode: 'no-cors' + a plain-text content type avoids a CORS preflight
    // that Google Apps Script's default web app doesn't handle — the
    // response is opaque either way, which is fine, nothing here reads it.
    fetch(SHEET_WEBHOOK_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(order),
    }).catch(() => {});
  }

  showOrderSuccess(order) {
    this.root.innerHTML = `
      <div class="order-success">
        <h2>Order Received! 🎉</h2>
        <div class="order-ref">${escapeHtml(order.order_ref)}</div>
        <p>Thanks${order.customer_name ? ', ' + escapeHtml(order.customer_name) : ''}! Have <strong>${money(order.total_ec)}</strong> ready when you collect — tap below to send us your order on WhatsApp so we can confirm it.</p>
        <p style="font-size:.85rem">Keep this reference handy — it's how we find your order.</p>
        <div style="display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap;margin-top:1rem">
          <a class="btn btn-olive" href="${waLink(this.menuStore.whatsapp, this.orderWhatsAppMessage(order))}" target="_blank" rel="noopener">Message Us on WhatsApp</a>
          <button class="btn btn-outline" data-action="new-order">Start a New Order</button>
        </div>
      </div>`;
  }

  // Packs the order reference, items and total into the WhatsApp message so
  // whoever reads it has everything they need at a glance.
  orderWhatsAppMessage(order) {
    const items = (order.items || [])
      .map(i => `${i.quantity}x ${i.item_name}${i.size ? ' (' + i.size + ')' : ''}`)
      .join(', ');
    return `Hi! Just placed order ${order.order_ref} — ${items} — Total: ${money(order.total_ec)}`;
  }
}
