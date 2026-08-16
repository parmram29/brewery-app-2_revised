const mysql = require('mysql2/promise');
require('dotenv').config();

// Kept low deliberately: on serverless (Vercel) each concurrent instance
// opens its own pool, so "connectionLimit" is really a per-instance cap, not
// a whole-app one — a generous number here multiplies across instances and
// exhausts a hosted database's total connection limit fast (small managed
// MySQL plans, e.g. Clever Cloud's dev tier, often cap out around 5 total).
// idleTimeout releases unused connections quickly so they don't sit open
// and starve other instances or a developer's local `mysql` client.
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'sweet_crispy',
  waitForConnections: true,
  connectionLimit: 2,
  maxIdle: 1,
  idleTimeout: 10000,
  timezone: '+00:00',
});
module.exports = pool;
