const router = require('express').Router();
const db = require('../db/pool');
const { requireStaff } = require('../lib/auth');
router.get('/summary', requireStaff, async (req, res) => {
  try {
    const [[totals]] = await db.query(`
      SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_ec ELSE 0 END), 0) AS gross_revenue,
        COALESCE(AVG(total_ec), 0) AS avg_order,
        SUM(status = 'pending')       AS pending_count,
        SUM(payment_status = 'paid')  AS paid_count
      FROM orders`);
    const [[today]] = await db.query(`
      SELECT COUNT(*) AS orders_today,
             COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_ec ELSE 0 END), 0) AS revenue_today
      FROM orders WHERE DATE(created_at) = CURDATE()`);
    res.json({ ok: true, summary: { ...totals, ...today } });
  } catch (err) { res.status(500).json({ ok: false, error: 'Database error' }); }
});
router.get('/top-items', requireStaff, async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  try {
    const [rows] = await db.query('SELECT * FROM top_items LIMIT ?', [limit]);
    res.json({ ok: true, items: rows });
  } catch (err) { res.status(500).json({ ok: false, error: 'Database error' }); }
});
module.exports = router;
