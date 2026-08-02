const router = require('express').Router();
const db = require('../db/pool');
const { requireStaff } = require('../lib/auth');
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM specials WHERE active = 1 ORDER BY created_at DESC');
    res.json({ ok: true, specials: rows });
  } catch (err) { res.status(500).json({ ok: false, error: 'Database error' }); }
});
router.post('/', requireStaff, async (req, res) => {
  const { name, description, category, price_ec, original_ec } = req.body;
  if (!name || !price_ec) return res.status(400).json({ ok: false, error: 'name and price_ec required' });
  try {
    const [result] = await db.query(
      'INSERT INTO specials (name, description, category, price_ec, original_ec) VALUES (?, ?, ?, ?, ?)',
      [name, description || null, category || null, price_ec, original_ec || null]
    );
    const [rows] = await db.query('SELECT * FROM specials WHERE id = ?', [result.insertId]);
    res.status(201).json({ ok: true, special: rows[0] });
  } catch (err) { res.status(500).json({ ok: false, error: 'Database error' }); }
});
router.delete('/:id', requireStaff, async (req, res) => {
  try {
    await db.query('UPDATE specials SET active = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: 'Database error' }); }
});
module.exports = router;
