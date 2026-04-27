require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth',         require('./routes/auth'));
app.use('/api/menu',         require('./routes/menu'));
app.use('/api/specials',     require('./routes/specials'));
app.use('/api/orders',       require('./routes/orders'));
app.use('/api/sales',        require('./routes/sales'));
app.use('/api/reservations', require('./routes/reservations'));

app.get('/api/ping', (req, res) => res.json({ ok: true, message: 'Brewery server running' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ✓  Brewery server running');
  console.log(`  ✓  Local:   http://localhost:${PORT}`);
  console.log(`  ✓  Network: http://<your-mac-ip>:${PORT}`);
  console.log('');
});
