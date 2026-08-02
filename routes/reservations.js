const router = require('express').Router();
const db     = require('../db/pool');
const { makeRef, rateLimit } = require('../lib/security');
const { requireStaff } = require('../lib/auth');
const { log } = require('../lib/log');

// GET /api/reservations?date=YYYY-MM-DD&status=confirmed
router.get('/', requireStaff, async (req, res) => {
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
router.get('/slots', rateLimit('res-slots', 60, 5 * 60 * 1000), async (req, res) => {
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

// POST /api/reservations — staff-only: record a booking taken by phone.
//
// Staff-only because the customer-facing booking UI was removed, which makes
// an unauthenticated write endpoint pure attack surface: it accepted arbitrary
// names, phone numbers and notes from anyone on the internet, straight into
// the table staff read every shift. An endpoint nothing calls should not be
// exposed; the smallest reachable surface is the cheapest control there is.
router.post('/', requireStaff, async (req, res) => {
  const { guest_name, phone, party_size, res_date, res_time, notes } = req.body || {};
  const name = (guest_name || '').trim();
  const party = parseInt(party_size, 10);

  if (!name || name.length > 100) return res.status(400).json({ ok: false, error: 'Guest name required' });
  // Bounded explicitly: unvalidated it went straight into SUM(party_size),
  // so one absurd value could mark every slot full for the whole service.
  if (!Number.isInteger(party) || party < 1 || party > 50) {
    return res.status(400).json({ ok: false, error: 'Party size must be between 1 and 50' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(res_date || '')) return res.status(400).json({ ok: false, error: 'Invalid date' });
  if (!/^\d{2}:\d{2}$/.test(res_time || '')) return res.status(400).json({ ok: false, error: 'Invalid time' });

  const conn = await db.getConnection();
  try {
    // The capacity check and the insert must be one atomic unit. Previously
    // this read the current total, decided, then inserted — two people booking
    // the same slot simultaneously both read the old total and both passed,
    // overbooking the restaurant. SELECT … FOR UPDATE holds the rows until the
    // transaction commits, so the second booking sees the first.
    await conn.beginTransaction();

    const [[setting]] = await conn.query("SELECT `value` FROM settings WHERE `key` = 'max_covers_per_slot'");
    const maxCovers = parseInt(setting?.value || 20, 10);

    const [[{ booked }]] = await conn.query(
      `SELECT COALESCE(SUM(party_size), 0) AS booked
       FROM reservations
       WHERE res_date = ? AND res_time = ? AND status NOT IN ('cancelled','no-show')
       FOR UPDATE`,
      [res_date, res_time]
    );

    if ((parseInt(booked, 10) + party) > maxCovers) {
      await conn.rollback();
      return res.status(409).json({
        ok: false,
        error: 'Sorry, that time slot is full. Please choose another time.'
      });
    }

    const ref = makeRef('RES');
    const [result] = await conn.query(
      `INSERT INTO reservations (ref, guest_name, phone, party_size, res_date, res_time, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ref, name, (phone || '').trim().slice(0, 30) || null, party, res_date, res_time, (notes || '').slice(0, 500) || null]
    );

    const [rows] = await conn.query('SELECT * FROM reservations WHERE id = ?', [result.insertId]);
    await conn.commit();
    res.status(201).json({ ok: true, reservation: rows[0] });
  } catch (err) {
    await conn.rollback();
    log.error('reservation_create_failed', { message: err.message });
    res.status(500).json({ ok: false, error: 'Could not save reservation' });
  } finally {
    conn.release();
  }
});

// PATCH /api/reservations/:id/status — update status (seated, no-show, cancelled)
router.patch('/:id/status', requireStaff, async (req, res) => {
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
router.get('/admin/settings', requireStaff, async (req, res) => {
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
router.patch('/admin/settings', requireStaff, async (req, res) => {
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
