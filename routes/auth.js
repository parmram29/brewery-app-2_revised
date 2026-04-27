const router = require('express').Router();
require('dotenv').config();
router.post('/login', (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ ok: false, error: 'PIN required' });
  if (pin === process.env.ADMIN_PIN) res.json({ ok: true });
  else res.status(401).json({ ok: false, error: 'Incorrect PIN' });
});
module.exports = router;
