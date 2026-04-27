const router = require('express').Router();
const db = require('../db/pool');
function makeRef() { return 'ORD-' + String(Math.floor(Math.random() * 99999)).padStart(5, '0'); }
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    let sql = 'SELECT * FROM orders'; const params = [];
    if (status) { sql += ' WHERE status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC LIMIT 200';
    const [orders] = await db.query(sql, params);
    for (const o of orders) {
      const [items] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [o.id]);
      o.items = items;
    }
    res.json({ ok: true, orders });
  } catch (err) { res.status(500).json({ ok: false, error: 'Database error' }); }
});
router.post('/', async (req, res) => {
  const { table_number, notes, items } = req.body;
  if (!table_number || !items?.length) return res.status(400).json({ ok: false, error: 'table_number and items required' });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const total_ec = items.reduce((sum, i) => sum + parseFloat(i.unit_price) * parseInt(i.quantity), 0);
    const order_ref = makeRef();
    const [orderResult] = await conn.query(
      'INSERT INTO orders (order_ref, table_number, notes, total_ec) VALUES (?, ?, ?, ?)',
      [order_ref, table_number, notes || null, total_ec]
    );
    for (const item of items) {
      await conn.query('INSERT INTO order_items (order_id, item_name, unit_price, quantity) VALUES (?, ?, ?, ?)',
        [orderResult.insertId, item.item_name, item.unit_price, item.quantity]);
    }
    await conn.commit();
    const [newOrder] = await conn.query('SELECT * FROM orders WHERE id = ?', [orderResult.insertId]);
    const [newItems] = await conn.query('SELECT * FROM order_items WHERE order_id = ?', [orderResult.insertId]);
    newOrder[0].items = newItems;
    res.status(201).json({ ok: true, order: newOrder[0] });
  } catch (err) { await conn.rollback(); res.status(500).json({ ok: false, error: 'Could not save order' }); }
  finally { conn.release(); }
});
router.patch('/:id/status', async (req, res) => {
  const { status, payment_method } = req.body;
  const allowed = ['pending','preparing','ready','paid','cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ ok: false, error: 'Invalid status' });
  try {
    const paidAt = status === 'paid' ? new Date() : null;
    await db.query('UPDATE orders SET status = ?, payment_method = ?, paid_at = ? WHERE id = ?',
      [status, payment_method || null, paidAt, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: 'Database error' }); }
});
module.exports = router;
