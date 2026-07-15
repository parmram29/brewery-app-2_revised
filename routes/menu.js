const router = require('express').Router();
const db = require('../db/pool');

// GET /api/menu — full available menu, grouped implicitly by category/subcategory/sort_order
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM menu_items WHERE available = 1 ORDER BY category, sort_order, name'
    );
    res.json({ ok: true, items: rows });
  } catch (err) { res.status(500).json({ ok: false, error: 'Database error' }); }
});

// PATCH /api/menu/:id/toggle — staff: show/hide an item without deleting it
router.patch('/:id/toggle', async (req, res) => {
  try {
    await db.query('UPDATE menu_items SET available = NOT available WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: 'Database error' }); }
});

module.exports = router;
