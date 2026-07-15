const router = require('express').Router();
const db = require('../db/pool');
const { makeRef, rateLimit } = require('../lib/security');

const MAX_QTY = 20;
const MAX_LINES = 30;

// Resolve a cart (client only sends menu_item_id + quantity + optional size) against
// the database — price and name are NEVER trusted from the client, which prevents
// price tampering from the browser.
async function resolveCart(items) {
  if (!Array.isArray(items) || !items.length) return { error: 'Your cart is empty' };
  if (items.length > MAX_LINES) return { error: 'Too many items in one order' };

  const ids = [...new Set(items.map(i => parseInt(i.menu_item_id)))];
  if (ids.some(id => !Number.isInteger(id))) return { error: 'Invalid item in cart' };

  const [rows] = await db.query(
    `SELECT id, name, price_ec, price_large_ec FROM menu_items WHERE id IN (${ids.map(() => '?').join(',')}) AND available = 1`,
    ids
  );
  const byId = new Map(rows.map(r => [r.id, r]));

  const resolved = [];
  for (const raw of items) {
    const id = parseInt(raw.menu_item_id);
    const qty = parseInt(raw.quantity);
    const menuItem = byId.get(id);
    if (!menuItem) return { error: 'One of the items in your cart is no longer available' };
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return { error: 'Invalid quantity' };

    let size = null;
    let unit_price = parseFloat(menuItem.price_ec);
    if (menuItem.price_large_ec != null) {
      size = raw.size === 'L' ? 'L' : 'M';
      unit_price = size === 'L' ? parseFloat(menuItem.price_large_ec) : parseFloat(menuItem.price_ec);
    }

    // Special instructions are free text (e.g. "no onions", "extra spicy") —
    // capped in length and never interpreted, just stored and displayed.
    const special_instructions = typeof raw.special_instructions === 'string'
      ? raw.special_instructions.trim().slice(0, 300) || null
      : null;

    resolved.push({
      menu_item_id: id,
      item_name: menuItem.name,
      size,
      unit_price,
      quantity: qty,
      special_instructions,
    });
  }
  return { resolved };
}

async function attachItems(orders) {
  for (const o of orders) {
    const [items] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [o.id]);
    o.items = items;
  }
}

router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    let sql = 'SELECT * FROM orders'; const params = [];
    if (status) { sql += ' WHERE status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC LIMIT 200';
    const [orders] = await db.query(sql, params);
    await attachItems(orders);
    res.json({ ok: true, orders });
  } catch (err) { res.status(500).json({ ok: false, error: 'Database error' }); }
});

// GET /api/orders/track/:ref — customer-facing lookup by order reference (no admin data)
router.get('/track/:ref', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, order_ref, status, payment_method, payment_status, subtotal_ec, total_ec, created_at FROM orders WHERE order_ref = ?',
      [req.params.ref]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Order not found' });
    await attachItems(rows);
    res.json({ ok: true, order: rows[0] });
  } catch (err) { res.status(500).json({ ok: false, error: 'Database error' }); }
});

// POST /api/orders — create a new order from a cart. Items are re-priced from the
// database on every request. payment_method chooses the next step on the client:
// 'cash' orders are confirmed immediately (pay at pickup); 'card' orders still need
// a Stripe Checkout Session created via /api/payments/checkout-session.
router.post('/', rateLimit('create-order', 15, 10 * 60 * 1000), async (req, res) => {
  const { customer_name, phone, notes, items, payment_method } = req.body;
  const name = (customer_name || '').trim();
  const ph = (phone || '').trim();
  if (!name || name.length > 100) return res.status(400).json({ ok: false, error: 'Please enter your name' });
  if (!ph || ph.length > 30) return res.status(400).json({ ok: false, error: 'Please enter a phone number' });
  if (!['card', 'cash'].includes(payment_method)) return res.status(400).json({ ok: false, error: 'Choose a payment method' });

  const { error, resolved } = await resolveCart(items).catch(() => ({ error: 'Database error' }));
  if (error) return res.status(400).json({ ok: false, error });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const total_ec = resolved.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
    const order_ref = makeRef('ORD');
    const [orderResult] = await conn.query(
      `INSERT INTO orders (order_ref, customer_name, phone, notes, subtotal_ec, total_ec, payment_method)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [order_ref, name, ph, (notes || '').slice(0, 500) || null, total_ec, total_ec, payment_method]
    );
    for (const item of resolved) {
      await conn.query(
        'INSERT INTO order_items (order_id, menu_item_id, item_name, size, unit_price, quantity, special_instructions) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [orderResult.insertId, item.menu_item_id, item.item_name, item.size, item.unit_price, item.quantity, item.special_instructions]
      );
    }
    await conn.commit();
    const [newOrder] = await conn.query('SELECT * FROM orders WHERE id = ?', [orderResult.insertId]);
    const [newItems] = await conn.query('SELECT * FROM order_items WHERE order_id = ?', [orderResult.insertId]);
    newOrder[0].items = newItems;
    res.status(201).json({ ok: true, order: newOrder[0] });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ ok: false, error: 'Could not save order' });
  } finally { conn.release(); }
});

// PATCH /api/orders/:id/items — edit an order's items, only while it is still
// pending and unpaid (covers "I want to change my order before paying/pickup").
router.patch('/:id/items', async (req, res) => {
  const { items } = req.body;
  const conn = await db.getConnection();
  try {
    const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });
    if (order.status !== 'pending' || order.payment_status === 'paid') {
      return res.status(409).json({ ok: false, error: 'This order can no longer be edited' });
    }
    const { error, resolved } = await resolveCart(items);
    if (error) return res.status(400).json({ ok: false, error });

    await conn.beginTransaction();
    const total_ec = resolved.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
    await conn.query('DELETE FROM order_items WHERE order_id = ?', [order.id]);
    for (const item of resolved) {
      await conn.query(
        'INSERT INTO order_items (order_id, menu_item_id, item_name, size, unit_price, quantity, special_instructions) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [order.id, item.menu_item_id, item.item_name, item.size, item.unit_price, item.quantity, item.special_instructions]
      );
    }
    await conn.query('UPDATE orders SET subtotal_ec = ?, total_ec = ? WHERE id = ?', [total_ec, total_ec, order.id]);
    await conn.commit();
    const [updated] = await conn.query('SELECT * FROM orders WHERE id = ?', [order.id]);
    const [updatedItems] = await conn.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    updated[0].items = updatedItems;
    res.json({ ok: true, order: updated[0] });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ ok: false, error: 'Could not update order' });
  } finally { conn.release(); }
});

// PATCH /api/orders/:id/payment — staff-only: confirm a cash payment was collected.
// Card payments are marked paid exclusively by the Stripe webhook, never from here.
router.patch('/:id/payment', async (req, res) => {
  const { payment_status } = req.body;
  if (!['paid', 'unpaid'].includes(payment_status)) return res.status(400).json({ ok: false, error: 'Invalid payment status' });
  try {
    const [[order]] = await db.query('SELECT payment_method FROM orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });
    if (order.payment_method !== 'cash') return res.status(400).json({ ok: false, error: 'Only cash orders can be marked paid here' });
    await db.query('UPDATE orders SET payment_status = ?, paid_at = ? WHERE id = ?',
      [payment_status, payment_status === 'paid' ? new Date() : null, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: 'Database error' }); }
});

router.patch('/:id/status', async (req, res) => {
  const { status, payment_method } = req.body;
  const allowed = ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ ok: false, error: 'Invalid status' });
  try {
    await db.query('UPDATE orders SET status = ?, payment_method = COALESCE(?, payment_method) WHERE id = ?',
      [status, payment_method || null, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: 'Database error' }); }
});

module.exports = router;
