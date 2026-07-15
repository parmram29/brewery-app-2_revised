const router = require('express').Router();
const db     = require('../db/pool');
const { makeRef } = require('../lib/security');

// GET /api/reservations?date=YYYY-MM-DD&status=confirmed
router.get('/', async (req, res) => {
  try {
    const { date, status } = req.query;
    let sql = 'SELECT * FROM reservations WHERE 1=1';
    const params = [];
    if (date)   { sql += ' AND res_date = ?';   params.push(date); }
    if (status) { sql += ' AND status = ?';      params.push(status); }
    sql += ' ORDER BY res_date ASC, res_time ASC';
    const [rows] = await db.query(sql, params);
    res.json({ ok: true, reservations: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Database error' });
  }
});

// GET /api/reservations/slots?date=YYYY-MM-DD
// Returns available time slots for a date with remaining capacity
router.get('/slots', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ ok: false, error: 'date required' });

    const [[maxSetting]] = await db.query("SELECT `value` FROM settings WHERE `key` = 'max_covers_per_slot'");
    const [[openSetting]] = await db.query("SELECT `value` FROM settings WHERE `key` = 'res_open_time'");
    const [[closeSetting]] = await db.query("SELECT `value` FROM settings WHERE `key` = 'res_close_time'");
    const maxCovers = parseInt(maxSetting?.value || 20);
    const [openH] = (openSetting?.value || '11:00').split(':').map(Number);
    const [closeH] = (closeSetting?.value || '21:30').split(':').map(Number);

    const [booked] = await db.query(
      `SELECT res_time, SUM(party_size) AS booked
       FROM reservations
       WHERE res_date = ? AND status NOT IN ('cancelled','no-show')
       GROUP BY res_time`,
      [date]
    );
    const bookedMap = {};
    booked.forEach(b => { bookedMap[b.res_time] = parseInt(b.booked); });

    const slots = [];
    for (let h = openH; h <= closeH; h++) {
      for (const m of [0, 30]) {
        const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const remaining = maxCovers - (bookedMap[time] || 0);
        slots.push({ time, remaining, available: remaining > 0 });
      }
    }
    res.json({ ok: true, slots, maxCovers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Database error' });
  }
});

// POST /api/reservations — make a booking
router.post('/', async (req, res) => {
  const { guest_name, phone, party_size, res_date, res_time, notes } = req.body;
  const name = (guest_name || '').trim();
  if (!name || !party_size || !res_date || !res_time) {
    return res.status(400).json({ ok: false, error: 'Name, party size, date and time required' });
  }

  try {
    const [[setting]] = await db.query("SELECT `value` FROM settings WHERE `key` = 'max_covers_per_slot'");
    const maxCovers = parseInt(setting?.value || 20);

    const [[{ booked }]] = await db.query(
      `SELECT COALESCE(SUM(party_size), 0) AS booked
       FROM reservations
       WHERE res_date = ? AND res_time = ? AND status NOT IN ('cancelled','no-show')`,
      [res_date, res_time]
    );

    if ((parseInt(booked) + parseInt(party_size)) > maxCovers) {
      return res.status(409).json({
        ok: false,
        error: 'Sorry, that time slot is full. Please choose another time.'
      });
    }

    const ref = makeRef('RES');
    const [result] = await db.query(
      `INSERT INTO reservations (ref, guest_name, phone, party_size, res_date, res_time, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ref, name, (phone || '').trim() || null, party_size, res_date, res_time, (notes || '').slice(0, 500) || null]
    );

    const [rows] = await db.query('SELECT * FROM reservations WHERE id = ?', [result.insertId]);
    res.status(201).json({ ok: true, reservation: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Could not save reservation' });
  }
});

// PATCH /api/reservations/:id/status — update status (seated, no-show, cancelled)
router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  const allowed = ['confirmed', 'cancelled', 'seated', 'no-show'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ ok: false, error: 'Invalid status' });
  }
  try {
    await db.query('UPDATE reservations SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Database error' });
  }
});

// GET /api/reservations/admin/settings — get capacity/hours settings
router.get('/admin/settings', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM settings');
    const s = {};
    rows.forEach(r => { s[r.key] = r.value; });
    res.json({ ok: true, settings: s });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Database error' });
  }
});

// PATCH /api/reservations/admin/settings — update capacity
router.patch('/admin/settings', async (req, res) => {
  try {
    const { max_covers_per_slot } = req.body;
    if (max_covers_per_slot) {
      await db.query(
        "INSERT INTO settings (`key`, `value`) VALUES ('max_covers_per_slot', ?) ON DUPLICATE KEY UPDATE `value` = ?",
        [max_covers_per_slot, max_covers_per_slot]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Database error' });
  }
});

module.exports = router;
