import { fmtDate, fmt12, escapeHtml } from '../services/format.js';
import { waLink } from '../services/whatsapp.js';

/** Table reservation flow: date → party size → time slot → details. */
export class ReservePage {
  constructor({ api, menuStore, toast }) {
    this.api = api;
    this.menuStore = menuStore;
    this.toast = toast;
    this.root = document.getElementById('reserve-content');

    this.state = { date: '', time: '', partySize: 2, slots: [] };

    this.root.addEventListener('click', (e) => this.handleClick(e));
  }

  handleClick(e) {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const { action, date, time, delta } = t.dataset;
    switch (action) {
      case 'pick-date':   this.pickDate(date); break;
      case 'change-party': this.changeParty(parseInt(delta)); break;
      case 'pick-time':    if (t.dataset.available === '1') this.pickTime(time); break;
      case 'book':         this.submitReservation(); break;
      case 'book-again':   this.state.time = ''; this.render(); break;
    }
  }

  render() {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const iso = d.toISOString().split('T')[0];
      const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'short' });
      const num = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      days.push({ iso, label, num });
    }
    if (!this.state.date) this.state.date = days[0].iso;

    this.root.innerHTML = `
      <div class="res-layout">
        <div>
          <div class="step-label">1 · Choose a Date</div>
          <div class="date-tabs">${days.map(d => `
            <div class="date-tab${d.iso === this.state.date ? ' on' : ''}" data-action="pick-date" data-date="${d.iso}">
              <span class="dt-day">${d.num}</span><span>${d.label}</span>
            </div>`).join('')}</div>

          <div class="step-label">2 · Party Size</div>
          <div style="margin-bottom:1.75rem">
            <div class="party-stepper">
              <button class="ps-btn" data-action="change-party" data-delta="-1">−</button>
              <span class="ps-num" id="party-num">${this.state.partySize}</span>
              <button class="ps-btn" data-action="change-party" data-delta="1">+</button>
              <span class="ps-label">guests</span>
            </div>
          </div>

          <div class="step-label">3 · Pick a Time</div>
          <div class="slot-grid" id="slot-grid"><div style="color:var(--ink-dim);font-size:.82rem;grid-column:1/-1"><span class="spinner" style="border-color:var(--line);border-top-color:var(--terracotta)"></span>Loading times…</div></div>
        </div>

        <div class="cart-panel">
          <h3>Your Reservation</h3>
          <div class="sub">Confirm the details below</div>
          <div class="sum-row"><div class="sum-lbl">Date</div><div class="sum-val" id="sum-date">${fmtDate(this.state.date)}</div></div>
          <div class="sum-row"><div class="sum-lbl">Time</div><div class="sum-val" id="sum-time" style="color:var(--ink-dim)">Not selected</div></div>
          <div class="sum-row"><div class="sum-lbl">Party</div><div class="sum-val" id="sum-party">${this.state.partySize} guests</div></div>
          <div style="margin-top:1.25rem">
            <div class="field"><label>Your Name</label><input id="res-name" placeholder="First & last name"></div>
            <div class="field"><label>Phone</label><input id="res-phone" placeholder="+1 (473) …" type="tel"></div>
            <div class="field"><label>Anything we should know?</label><textarea id="res-notes" placeholder="Allergies, occasion, etc."></textarea></div>
          </div>
          <button class="btn btn-fill btn-block" id="book-btn" data-action="book" disabled>Confirm Reservation</button>
        </div>
      </div>`;

    this.loadSlots(this.state.date);
  }

  async loadSlots(date) {
    const res = await this.api.get('/api/reservations/slots?date=' + date);
    const grid = document.getElementById('slot-grid');
    if (!grid) return;
    if (!res.ok) { grid.innerHTML = '<div style="color:var(--ink-dim);font-size:.82rem;grid-column:1/-1">Could not load times.</div>'; return; }
    this.state.slots = res.slots;
    grid.innerHTML = res.slots.map(s => `
      <div class="slot-btn${!s.available ? ' full' : ''}${this.state.time === s.time ? ' picked' : ''}"
           data-action="pick-time" data-time="${s.time}" data-available="${s.available ? 1 : 0}">
        <span class="slot-time">${fmt12(s.time)}</span>
        <span class="slot-left${s.remaining <= 5 ? ' low' : ''}">${s.available ? (s.remaining <= 5 ? `${s.remaining} left` : 'Available') : 'Full'}</span>
      </div>`).join('');
  }

  pickDate(date) {
    this.state.date = date; this.state.time = '';
    document.querySelectorAll('.date-tab').forEach(d => d.classList.remove('on'));
    this.root.querySelector(`[data-action="pick-date"][data-date="${date}"]`)?.classList.add('on');
    document.getElementById('sum-date').textContent = fmtDate(date);
    document.getElementById('sum-time').textContent = 'Not selected';
    document.getElementById('sum-time').style.color = 'var(--ink-dim)';
    this.loadSlots(date);
    this.updateBookButton();
  }

  pickTime(time) {
    this.state.time = time;
    document.querySelectorAll('.slot-btn').forEach(s => s.classList.remove('picked'));
    this.root.querySelector(`[data-action="pick-time"][data-time="${time}"]`)?.classList.add('picked');
    const tv = document.getElementById('sum-time');
    tv.textContent = fmt12(time); tv.style.color = 'var(--ink)';
    this.updateBookButton();
  }

  changeParty(delta) {
    this.state.partySize = Math.max(1, Math.min(30, this.state.partySize + delta));
    document.getElementById('party-num').textContent = this.state.partySize;
    document.getElementById('sum-party').textContent = this.state.partySize + ' guests';
  }

  updateBookButton() {
    const btn = document.getElementById('book-btn');
    if (btn) btn.disabled = !(this.state.date && this.state.time);
  }

  async submitReservation() {
    const name = document.getElementById('res-name')?.value.trim();
    const phone = document.getElementById('res-phone')?.value.trim();
    const notes = document.getElementById('res-notes')?.value.trim();
    if (!name) { this.toast.show('Please enter your name', 'err'); return; }
    const btn = document.getElementById('book-btn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Booking…';
    const res = await this.api.post('/api/reservations', {
      guest_name: name, phone, party_size: this.state.partySize,
      res_date: this.state.date, res_time: this.state.time, notes,
    });
    if (!res.ok) { this.toast.show(res.error, 'err'); btn.disabled = false; btn.textContent = 'Confirm Reservation'; return; }
    const r = res.reservation;
    this.root.innerHTML = `
      <div class="order-success">
        <h2>You're Booked! 🎉</h2>
        <div class="order-ref">${escapeHtml(r.ref)}</div>
        <p><strong>${escapeHtml(r.guest_name)}</strong> · ${r.party_size} guests<br>${fmtDate(r.res_date)} at ${fmt12(r.res_time)}</p>
        <p>Just give your name at the door. See you soon!</p>
        <div style="display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap;margin-top:1rem">
          <a class="btn btn-olive" href="${waLink(this.menuStore.whatsapp, 'Hi! Just booked reservation ' + r.ref)}" target="_blank" rel="noopener">Message Us on WhatsApp</a>
          <button class="btn btn-outline" data-action="book-again">Make Another Booking</button>
        </div>
      </div>`;
    this.toast.show('Reservation confirmed! ' + r.ref, 'ok');
  }
}
