// ============================================================
// New-order email notification via Resend (https://resend.com).
//
// Optional by design, same pattern as PAYMENT_PROVIDER=none: without
// RESEND_API_KEY and OWNER_EMAIL set, this quietly does nothing rather than
// failing an order over a missing notification integration. An order that
// saved correctly must never fail just because an email couldn't be sent, so
// every call site fires this and ignores the outcome — a broken notification
// should never block or roll back a real order.
// ============================================================

const { log } = require('./log');

function isConfigured() {
  return !!(process.env.RESEND_API_KEY && process.env.OWNER_EMAIL);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function notifyNewOrder(order) {
  if (!isConfigured()) return;

  const items = (order.items || [])
    .map(i => `${i.quantity}x ${i.item_name}${i.size ? ' (' + i.size + ')' : ''}`)
    .join(', ');
  const total = Number(order.total_ec).toFixed(2);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Sweet & Crispy Orders <onboarding@resend.dev>',
        to: process.env.OWNER_EMAIL,
        subject: `New order ${order.order_ref} — $${total}`,
        html: `
          <h2>New order: ${escapeHtml(order.order_ref)}</h2>
          <p><strong>${escapeHtml(order.customer_name || '')}</strong> — ${escapeHtml(order.phone || '')}</p>
          <p>${escapeHtml(items)}</p>
          <p><strong>Total: $${total}</strong> (${escapeHtml(order.payment_method || '')})</p>
          ${order.notes ? `<p>Note: ${escapeHtml(order.notes)}</p>` : ''}
        `,
      }),
    });
    if (!res.ok) {
      log.error('order_notify_failed', { status: res.status, order_ref: order.order_ref });
    }
  } catch (err) {
    // Network error, Resend down, etc. — never let this affect the order.
    log.error('order_notify_failed', { message: err.message, order_ref: order.order_ref });
  }
}

module.exports = { notifyNewOrder, isConfigured };
