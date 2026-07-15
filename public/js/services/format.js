// ============================================================
// Pure formatting helpers — no state, safe to import anywhere.
// ============================================================

export function money(n) { return 'EC$' + Number(n).toFixed(0); }

export function fmtDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function fmt12(t) {
  const [h, m] = t.split(':').map(Number);
  return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Escapes text before it is interpolated into an innerHTML template string.
 * Every value that originated from a customer (name, phone, notes) MUST be
 * passed through this before being rendered — otherwise a name/note like
 * `<img src=x onerror=...>` would execute in the staff admin dashboard
 * (stored XSS). Menu/specials copy is staff-entered and lower risk, but is
 * escaped too for consistency.
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}
