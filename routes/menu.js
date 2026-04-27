const router = require('express').Router();
const db = require('../db/pool');
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM menu_items WHERE available = 1 ORDER BY category, name');
    res.json({ ok: true, items: rows });
  } catch (err) { res.status(500).json({ ok: false, error: 'Database error' }); }
});
router.patch('/:id/toggle', async (req, res) => {
  try {
    await db.query('UPDATE menu_items SET available = NOT available WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: 'Database error' }); }
});
module.exports = router;
