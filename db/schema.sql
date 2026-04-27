-- ============================================================
-- West Indies Beer Company — Database Schema
-- Run once:  mysql -u root -p < db/schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS brewery_app
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE brewery_app;

-- ── Menu items ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_items (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100)   NOT NULL,
  category    VARCHAR(50)    NOT NULL,
  abv         VARCHAR(10),
  description TEXT,
  price_ec    DECIMAL(8,2)   NOT NULL,
  available   TINYINT(1)     NOT NULL DEFAULT 1,
  is_flagship TINYINT(1)     NOT NULL DEFAULT 0,
  created_at  TIMESTAMP      DEFAULT CURRENT_TIMESTAMP
);

-- ── Daily specials ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS specials (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(100)  NOT NULL,
  description  TEXT,
  category     VARCHAR(50),
  price_ec     DECIMAL(8,2)  NOT NULL,
  original_ec  DECIMAL(8,2),
  active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

-- ── Orders ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  order_ref      VARCHAR(20)   NOT NULL UNIQUE,
  table_number   VARCHAR(10)   NOT NULL,
  notes          TEXT,
  total_ec       DECIMAL(8,2)  NOT NULL DEFAULT 0,
  status         ENUM('pending','preparing','ready','paid','cancelled') NOT NULL DEFAULT 'pending',
  payment_method VARCHAR(30),
  paid_at        TIMESTAMP     NULL,
  created_at     TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ── Order line items ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  order_id    INT           NOT NULL,
  item_name   VARCHAR(100)  NOT NULL,
  unit_price  DECIMAL(8,2)  NOT NULL,
  quantity    INT           NOT NULL DEFAULT 1,
  line_total  DECIMAL(8,2)  GENERATED ALWAYS AS (unit_price * quantity) STORED,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- ── Reservations ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reservations (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  ref          VARCHAR(20)   NOT NULL UNIQUE,
  guest_name   VARCHAR(100)  NOT NULL,
  phone        VARCHAR(30),
  party_size   INT           NOT NULL DEFAULT 1,
  res_date     DATE          NOT NULL,
  res_time     VARCHAR(10)   NOT NULL,
  food_choice  VARCHAR(100),              -- e.g. "Bottomless Mimosa Brunch"
  notes        TEXT,
  status       ENUM('confirmed','cancelled','seated','no-show') NOT NULL DEFAULT 'confirmed',
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

-- ── Settings (owner-controlled values) ───────────────────────
CREATE TABLE IF NOT EXISTS settings (
  `key`       VARCHAR(60)   PRIMARY KEY,
  `value`     VARCHAR(255)  NOT NULL,
  updated_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Default settings
INSERT IGNORE INTO settings (`key`, `value`) VALUES
  ('max_covers_per_slot', '20'),
  ('res_slot_duration',   '90'),
  ('res_open_time',       '08:00'),
  ('res_close_time',      '22:00');

-- ── Views ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW daily_sales AS
SELECT
  DATE(o.created_at)        AS sale_date,
  COUNT(DISTINCT o.id)      AS order_count,
  COALESCE(SUM(o.total_ec), 0) AS gross_revenue,
  COALESCE(AVG(o.total_ec), 0) AS avg_order_value,
  SUM(o.status = 'paid')    AS paid_orders,
  SUM(o.status = 'pending') AS pending_orders
FROM orders o
GROUP BY DATE(o.created_at)
ORDER BY sale_date DESC;

CREATE OR REPLACE VIEW top_items AS
SELECT
  oi.item_name,
  SUM(oi.quantity)   AS total_sold,
  SUM(oi.line_total) AS total_revenue
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
GROUP BY oi.item_name
ORDER BY total_sold DESC;

-- ── Seed: beer menu ───────────────────────────────────────────
INSERT INTO menu_items (name, category, abv, description, price_ec, is_flagship) VALUES
('Windward IPA',        'IPA',    '6.8%', 'Our flagship IPA — citrus hops, refreshingly easy bitterness',   18.00, 1),
('Dockside ESB',        'Ale',    '5.9%', 'A classic English Extra Special Bitter',                          16.00, 0),
('Black Rock IPA',      'IPA',    '8.3%', 'Strong, dark, bitter and packed with citrus hops',               20.00, 0),
('Lazy Pelican',        'Ale',    '5.2%', 'A summer wheat beer with citrusy orange aromas',                  16.00, 0),
('Light Cider',         'Cider',  '4.8%', 'Varieties: mango, pomegranate, ginger, watermelon',              15.00, 0),
('Outback Cider',       'Cider',  '7.0%', 'Strong, cloudy, scrumpy — no finesse, just as cider should be', 18.00, 0),
('Sundown Cider',       'Cider',  '5.9%', 'Sparkling, crisp, medium dry cider',                             16.00, 0),
('Mosaic',              'Ale',    '4.66%','A refreshing pale ale',                                           15.00, 0),
('Grumpy Pete',         'Stout',  '6.4%', 'A traditional English stout',                                    16.00, 0),
('Humdinger',           'Lager',  '5.0%', 'A lager of outstanding excellence',                              15.00, 0),
('Old Mongoose Porter', 'Porter', '7.1%', 'A smooth, malty, light-bodied porter',                           18.00, 0),
('Island Hog',          'Ale',    '3.8%', 'A zesty amber ale',                                              14.00, 0),
('Buccaneer',           'Saison', '5.6%', 'A tasty Belgian saison',                                         16.00, 0),
('Hawk Tripel',         'Ale',    '7.9%', 'Strong, pale and fruity — classic Belgian Tripel',               20.00, 0),
('Drunken Goat',        'Ale',    '5.5%', 'A hazy Belgian wheat beer',                                      16.00, 0),
('Rogue Pirate',        'Ale',    '4.4%', 'An English amber bitter',                                        15.00, 0);
