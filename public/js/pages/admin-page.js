import { money, escapeHtml } from '../services/format.js';

/**
 * Staff dashboard: auth gate, live orders, menu visibility, today's
 * special, and the sales report.
 *
 * Security note: this screen is a UX convenience, never the access-control
 * boundary. Hiding the dashboard in the browser protects nothing — the real
 * check is requireStaff() on every staff route server-side, which rejects a
 * request without a valid session cookie no matter what the UI shows. Shared
 * PIN is appropriate for one small team sharing one dashboard; individual
 * staff accounts would be a per-user session rework, not a UI change.
 */
export class AdminPage {
  constructor({ api, toast }) {
    this.api = api;
    this.toast = toast;
    this.root = document.getElementById('page-admin');

    this.liveFilter = 'pending';
    this.menuCat = 'pizza';
    this.specials = [];
    this.menuItems = [];

    this.root.addEventListener('click', (e) => this.handleClick(e));
    this.root.addEventListener('keydown', (e) => this.handleKeydown(e));

    // If a session expires mid-shift, every later call 401s. Drop straight back
    // to the PIN screen instead of leaving a dashboard that silently fails.
    this.api.onUnauthorized = () => this.handleSessionExpired();
  }

  // Restores the dashboard after a page refresh without re-entering the PIN,
  // since the session lives in an HttpOnly cookie the page cannot read.
  async onEnter() {
    const res = await this.api.get('/api/auth/session');
    if (res.ok && res.authenticated) this.showDashboard();
  }

  handleKeydown(e) {
    if (e.target.id === 'pin-input' && e.key === 'Enter') this.login();
  }

  handleClick(e) {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const d = t.dataset;
    switch (d.action) {
      case 'login':  this.login(); break;
      case 'logout': this.logout(); break;
      case 'switch-tab': this.switchTab(d.tab, t); break;

      case 'filter-live':      this.setLiveFilter(d.status, t); break;
      case 'set-order-status': this.setOrderStatus(parseInt(d.id), d.status); break;
      case 'mark-cash-paid':   this.markCashPaid(parseInt(d.id)); break;

      case 'filter-menu-cat':  this.setMenuCat(d.cat, t); break;
      case 'toggle-menu-item': this.toggleMenuItem(parseInt(d.id)); break;

      case 'add-special':    this.addSpecial(); break;
      case 'remove-special': this.removeSpecial(parseInt(d.id)); break;
    }
  }

  // ── Auth ──────────────────────────────────────────────────────
  async login() {
    const input = document.getElementById('pin-input');
    const res = await this.api.post('/api/auth/login', { pin: input.value });
    input.value = '';
    if (!res.ok) {
      // Surfaces the server's message so a rate-limit lockout reads as such
      // rather than looking like a wrong PIN.
      this.toast.show(res.error || 'Wrong PIN', 'err');
      return;
    }
    this.showDashboard();
  }

  async logout() {
    // Destroys the session server-side — clearing the screen alone would leave
    // a valid cookie that still authorises every staff endpoint.
    await this.api.post('/api/auth/logout');
    this.showGate();
  }

  showDashboard() {
    document.getElementById('admin-gate').style.display = 'none';
    document.getElementById('admin-dash').style.display = 'block';
    this.renderLiveOrders(); this.loadMenu(); this.loadSpecials(); this.renderSales();
  }

  showGate() {
    document.getElementById('admin-gate').style.display = 'block';
    document.getElementById('admin-dash').style.display = 'none';
    document.getElementById('pin-input').value = '';
  }

  handleSessionExpired() {
    this.showGate();
    this.toast.show('Session expired — please sign in again', 'err');
  }

  switchTab(tab, btn) {
    this.root.querySelectorAll('.ap').forEach(p => p.classList.remove('on'));
    this.root.querySelectorAll('.asb').forEach(b => b.classList.remove('on'));
    document.getElementById('ap-' + tab).classList.add('on');
    btn.classList.add('on');
    if (tab === 'live')         this.renderLiveOrders();
    if (tab === 'menu')         this.loadMenu();
    if (tab === 'specials')     this.loadSpecials();
    if (tab === 'sales')        this.renderSales();
  }

  // ── Live orders ───────────────────────────────────────────────
  setLiveFilter(status, btn) {
    this.liveFilter = status;
    this.root.querySelectorAll('#ap-live .order-cat-btn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    this.renderLiveOrders();
  }

  async renderLiveOrders() {
    const filter = this.liveFilter === 'all' ? '' : '?status=' + this.liveFilter;
    const res = await this.api.get('/api/orders' + filter);
    const el = document.getElementById('live-list');
    if (!res.ok) { el.innerHTML = '<p style="color:var(--ink-dim)">Could not load orders.</p>'; return; }
    if (!res.orders.length) { el.innerHTML = '<p style="color:var(--ink-soft);font-style:italic;text-align:center;padding:2rem">No orders here.</p>'; return; }
    el.innerHTML = res.orders.map(o => `
      <div class="live-card">
        <div class="live-card-head">
          <div><div class="live-id">${escapeHtml(o.order_ref)} — ${escapeHtml(o.customer_name)}</div>
          <div class="live-meta">${escapeHtml(o.phone)} · ${new Date(o.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ${money(o.total_ec)} ·
            <span class="badge b-${o.status}">${o.status}</span>
            <span class="badge b-${o.payment_status}">${o.payment_method || '—'} · ${o.payment_status}</span></div></div>
        </div>
        <div class="live-items">${(o.items || []).map(i => `${escapeHtml(i.item_name)}${i.size ? ' (' + escapeHtml(i.size) + ')' : ''} ×${i.quantity}${i.special_instructions ? ` <em>(${escapeHtml(i.special_instructions)})</em>` : ''}`).join(' · ') || '—'}</div>
        ${o.notes ? `<div class="live-note">Note: ${escapeHtml(o.notes)}</div>` : ''}
        <div class="status-btns">
          ${o.status !== 'confirmed' ? `<button class="st-btn" data-action="set-order-status" data-id="${o.id}" data-status="confirmed">Confirm</button>` : ''}
          ${o.status !== 'preparing' ? `<button class="st-btn" data-action="set-order-status" data-id="${o.id}" data-status="preparing">Preparing</button>` : ''}
          ${o.status !== 'ready' ? `<button class="st-btn" data-action="set-order-status" data-id="${o.id}" data-status="ready">Ready</button>` : ''}
          ${o.status !== 'completed' ? `<button class="st-btn" data-action="set-order-status" data-id="${o.id}" data-status="completed">Completed</button>` : ''}
          ${o.payment_method === 'cash' && o.payment_status !== 'paid' ? `<button class="st-btn paid" data-action="mark-cash-paid" data-id="${o.id}">Mark Cash Paid ✓</button>` : ''}
        </div>
      </div>`).join('');
  }

  async setOrderStatus(id, status) {
    const res = await this.api.patch(`/api/orders/${id}/status`, { status });
    if (res.ok) { this.renderLiveOrders(); this.toast.show('Updated to ' + status, 'ok'); } else this.toast.show('Error: ' + res.error, 'err');
  }

  async markCashPaid(id) {
    const res = await this.api.patch(`/api/orders/${id}/payment`, { payment_status: 'paid' });
    if (res.ok) { this.renderLiveOrders(); this.toast.show('Marked as paid', 'ok'); } else this.toast.show('Error: ' + res.error, 'err');
  }

  // ── Menu visibility ───────────────────────────────────────────
  setMenuCat(cat, btn) {
    this.menuCat = cat;
    this.root.querySelectorAll('#ap-menu .order-cat-btn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    this.renderMenu();
  }

  async loadMenu() {
    const res = await this.api.get('/api/menu');
    if (res.ok) this.menuItems = res.items;
    this.renderMenu();
  }

  renderMenu() {
    const el = document.getElementById('admin-menu-list');
    const list = this.menuItems.filter(i => i.category === this.menuCat);
    el.innerHTML = list.map(i => `
      <div class="menu-admin-item${i.available ? '' : ' off'}">
        <div><div class="mai-name">${i.name}</div><div class="mai-meta">${i.subcategory} · ${money(i.price_ec)}${i.price_large_ec ? ' / ' + money(i.price_large_ec) : ''}</div></div>
        <button class="btn ${i.available ? 'btn-outline' : 'btn-fill'} btn-sm" data-action="toggle-menu-item" data-id="${i.id}">${i.available ? 'Hide' : 'Show'}</button>
      </div>`).join('');
  }

  async toggleMenuItem(id) {
    const res = await this.api.patch(`/api/menu/${id}/toggle`);
    if (res.ok) { await this.loadMenu(); this.toast.show('Updated', 'ok'); } else this.toast.show('Error', 'err');
  }

  // ── Today's special ───────────────────────────────────────────
  async loadSpecials() {
    const res = await this.api.get('/api/specials');
    if (res.ok) { this.specials = res.specials; this.renderSpecials(); }
  }

  async addSpecial() {
    const name = document.getElementById('sp-name').value.trim();
    const price = document.getElementById('sp-price').value;
    if (!name || !price) { this.toast.show('Name and price required', 'err'); return; }
    const res = await this.api.post('/api/specials', {
      name, description: document.getElementById('sp-desc').value,
      price_ec: parseFloat(price),
      original_ec: parseFloat(document.getElementById('sp-orig').value) || null,
      category: document.getElementById('sp-cat').value,
    });
    if (res.ok) {
      ['sp-name', 'sp-desc', 'sp-price', 'sp-orig'].forEach(id => document.getElementById(id).value = '');
      await this.loadSpecials(); this.toast.show('Special added!', 'ok');
    } else this.toast.show('Error: ' + res.error, 'err');
  }

  async removeSpecial(id) {
    const res = await this.api.delete('/api/specials/' + id);
    if (res.ok) { await this.loadSpecials(); this.toast.show('Removed'); }
  }

  renderSpecials() {
    const el = document.getElementById('admin-specials-list');
    if (!this.specials.length) { el.innerHTML = '<p style="color:var(--ink-dim);font-size:.82rem">No specials posted yet.</p>'; return; }
    el.innerHTML = `<p style="font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-dim);margin-bottom:.75rem">Active (${this.specials.length})</p>`
      + this.specials.map(s => `<div class="sp-row"><div><div class="sp-row-name">${s.name}</div><div class="sp-row-meta">${money(s.price_ec)} · ${s.category || '—'}</div></div><button class="del-btn" data-action="remove-special" data-id="${s.id}">Remove</button></div>`).join('');
  }

  // ── Sales report ──────────────────────────────────────────────
  async renderSales() {
    const [sumRes, topRes, ordRes] = await Promise.all([
      this.api.get('/api/sales/summary'),
      this.api.get('/api/sales/top-items?limit=8'),
      this.api.get('/api/orders'),
    ]);
    if (!sumRes.ok) return;
    const s = sumRes.summary;
    document.getElementById('stats-row').innerHTML = `
      <div class="stat"><div class="stat-lbl">Total Revenue (Paid)</div><div class="stat-val">${money(s.gross_revenue)}</div><div class="stat-note">All time</div></div>
      <div class="stat"><div class="stat-lbl">Today's Revenue</div><div class="stat-val">${money(s.revenue_today)}</div><div class="stat-note">${s.orders_today} orders</div></div>
      <div class="stat"><div class="stat-lbl">Avg Order</div><div class="stat-val">${money(s.avg_order)}</div><div class="stat-note">Per order</div></div>
      <div class="stat"><div class="stat-lbl">Pending</div><div class="stat-val">${s.pending_count}</div><div class="stat-note">Open orders</div></div>`;
    const items = topRes.ok ? topRes.items : [];
    const max = items[0]?.total_sold || 1;
    document.getElementById('top-chart').innerHTML = items.length
      ? items.map(i => `<div class="bar-r"><div class="b-lbl">${i.item_name}</div><div class="b-track"><div class="b-fill" style="width:${(i.total_sold / max * 100).toFixed(0)}%"></div></div><div class="b-num">${i.total_sold}</div></div>`).join('')
      : '<p style="color:var(--ink-dim);font-size:.82rem">No data yet.</p>';
    const orders = ordRes.ok ? ordRes.orders : [];
    document.getElementById('ord-tbody').innerHTML = orders.slice(0, 25).map(o => `<tr>
      <td>${escapeHtml(o.order_ref)}</td><td>${escapeHtml(o.customer_name)}</td>
      <td style="color:var(--ink-soft)">${escapeHtml((o.items || []).map(i => i.item_name).join(', ').slice(0, 40)) || '—'}</td>
      <td style="color:var(--terracotta)">${money(o.total_ec)}</td>
      <td>${o.payment_method || '—'}</td>
      <td><span class="badge b-${o.payment_status === 'paid' ? 'paid' : 'pending'}">${o.status}</span></td>
    </tr>`).join('') || '<tr><td colspan="6" style="color:var(--ink-dim);text-align:center;padding:2rem">No orders yet.</td></tr>';
  }
}
