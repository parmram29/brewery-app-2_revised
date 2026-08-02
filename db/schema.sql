-- ============================================================
-- Sweet & Crispy — Database Schema
-- Pizzeria & kitchen, True Blue, Grenada
-- Run once:  mysql -u root -p < db/schema.sql
--
-- Safe to re-run: every seed uses INSERT IGNORE against a UNIQUE
-- KEY, so repeated runs never duplicate menu items.
-- ============================================================

CREATE DATABASE IF NOT EXISTS sweet_crispy
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE sweet_crispy;

-- ── Menu items ────────────────────────────────────────────────
-- category: 'pizza' or 'food' — the two ordering tabs on the site.
-- subcategory: display grouping within a tab (e.g. "Stuffed Crust", "Burgers").
-- price_large_ec is reserved for items that offer a second size; the current
-- menu prices every item singly, so it is left NULL throughout.
CREATE TABLE IF NOT EXISTS menu_items (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(120)   NOT NULL,
  category       ENUM('pizza','food') NOT NULL,
  subcategory    VARCHAR(60)    NOT NULL,
  description    TEXT,
  price_ec       DECIMAL(8,2)   NOT NULL,
  price_large_ec DECIMAL(8,2)   NULL,
  available      TINYINT(1)     NOT NULL DEFAULT 1,
  is_signature   TINYINT(1)     NOT NULL DEFAULT 0,
  sort_order     INT            NOT NULL DEFAULT 0,
  created_at     TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_menu_item (name, category)
);

-- ── Today's specials (chef's feature, shown on the homepage) ──
CREATE TABLE IF NOT EXISTS specials (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(120)  NOT NULL,
  description  TEXT,
  category     VARCHAR(50),
  price_ec     DECIMAL(8,2)  NOT NULL,
  original_ec  DECIMAL(8,2),
  active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

-- ── Orders ────────────────────────────────────────────────────
-- Prices are ALWAYS resolved server-side from menu_items — never trust a client-supplied price.
CREATE TABLE IF NOT EXISTS orders (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  order_ref        VARCHAR(24)   NOT NULL UNIQUE,
  customer_name    VARCHAR(100)  NOT NULL,
  phone            VARCHAR(30)   NOT NULL,
  notes            TEXT,
  subtotal_ec      DECIMAL(8,2)  NOT NULL DEFAULT 0,
  total_ec         DECIMAL(8,2)  NOT NULL DEFAULT 0,
  status           ENUM('pending','confirmed','preparing','ready','completed','cancelled') NOT NULL DEFAULT 'pending',
  payment_method   ENUM('card','cash') NULL,
  payment_status   ENUM('unpaid','paid','failed') NOT NULL DEFAULT 'unpaid',
  -- Gateway-neutral: which provider handled it, and that provider's reference
  -- for the attempt. Named generically so switching gateways (EPay ↔ WiPay)
  -- is not a schema migration.
  payment_provider VARCHAR(20)  NULL,
  payment_ref      VARCHAR(255) NULL,
  paid_at          TIMESTAMP     NULL,
  created_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- Without this index every payment callback full-scans orders.
  KEY idx_orders_payment_ref (payment_ref),
  KEY idx_orders_status_created (status, created_at),
  KEY idx_orders_created (created_at)
);

-- ── Order line items ──────────────────────────────────────────
-- menu_item_id is kept for reference; name/price are snapshotted so historical
-- orders remain accurate even if the menu changes later.
CREATE TABLE IF NOT EXISTS order_items (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  order_id             INT           NOT NULL,
  menu_item_id         INT           NULL,
  item_name            VARCHAR(120)  NOT NULL,
  size                 VARCHAR(10)   NULL,
  unit_price           DECIMAL(8,2)  NOT NULL,
  quantity             INT           NOT NULL DEFAULT 1,
  special_instructions VARCHAR(300)  NULL,
  line_total           DECIMAL(8,2)  GENERATED ALWAYS AS (unit_price * quantity) STORED,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE SET NULL
);

-- ── Payment events (append-only audit log) ───────────────────
-- Every payment-related transition lands here: order created, checkout
-- opened, provider confirmed, cash confirmed. This is what a
-- reconciliation or a customer dispute is answered from.
--
-- Deliberately contains NO cardholder data — no PAN, no CVV, no expiry.
-- There is no column here that could hold one, which is what keeps this
-- application out of PCI DSS SAQ D scope. If anyone proposes storing card
-- details "to make refunds easier", the answer is no.
CREATE TABLE IF NOT EXISTS payment_events (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  order_id   INT           NULL,
  event      VARCHAR(60)   NOT NULL,
  method     VARCHAR(20)   NULL,
  amount_ec  DECIMAL(8,2)  NULL,
  detail     VARCHAR(255)  NULL,
  created_at TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pe_order (order_id),
  KEY idx_pe_created (created_at),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
);

-- ── Reservations ─────────────────────────────────────────────
-- Table booking is not exposed on the customer site; kept for the staff
-- dashboard and so historical bookings are not lost.
CREATE TABLE IF NOT EXISTS reservations (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  ref          VARCHAR(24)   NOT NULL UNIQUE,
  guest_name   VARCHAR(100)  NOT NULL,
  phone        VARCHAR(30),
  party_size   INT           NOT NULL DEFAULT 1,
  res_date     DATE          NOT NULL,
  res_time     VARCHAR(10)   NOT NULL,
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
  ('res_open_time',       '11:00'),
  ('res_close_time',      '21:30');

-- ── Views ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW daily_sales AS
SELECT
  DATE(o.created_at)          AS sale_date,
  COUNT(DISTINCT o.id)        AS order_count,
  COALESCE(SUM(o.total_ec), 0) AS gross_revenue,
  COALESCE(AVG(o.total_ec), 0) AS avg_order_value,
  SUM(o.payment_status = 'paid')    AS paid_orders,
  SUM(o.status = 'pending')   AS pending_orders
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
WHERE o.status <> 'cancelled'
GROUP BY oi.item_name
ORDER BY total_sold DESC;

-- ============================================================
-- Seed: the official Sweet & Crispy menu (107 items)
--
-- Names and prices are transcribed from the restaurant's live
-- KariBites listing. Prices are XCD (EC$), matching price_ec.
-- Some descriptions on that listing are visually truncated; where
-- the full text could not be read it is left NULL rather than
-- guessed. Staff can fill those in later without touching prices.
-- ============================================================

-- ── Pizza — Italian Pizza Menu (12") ─────────────────────────
INSERT IGNORE INTO menu_items (name, category, subcategory, description, price_ec, is_signature, sort_order) VALUES
('Ortoland (Veggie)',       'pizza', 'Italian Pizza', 'Napoletana sauce, mozzarella', 45.00, 0, 1),
('Spicy Elegant Chicken',   'pizza', 'Italian Pizza', 'Napoletana sauce, mozzarella', 45.00, 0, 2),
('Margherita Pizza',        'pizza', 'Italian Pizza', 'Napoletana sauce, fresh mozzarella', 40.00, 1, 3),
('Alfredo Chicken',         'pizza', 'Italian Pizza', 'Alfredo sauce, fresh mozzarella', 50.00, 0, 4),
('Buffalo Chicken Pizza',   'pizza', 'Italian Pizza', 'Napoletana sauce, mozzarella', 45.00, 0, 5),
('Prosciutto Pizza',        'pizza', 'Italian Pizza', 'Napoletana sauce, mozzarella', 50.00, 0, 6),
('Carciofi Pizza',          'pizza', 'Italian Pizza', 'Pesto sauce, mozzarella', 50.00, 0, 7),
('Caprese Pizza',           'pizza', 'Italian Pizza', 'Napoletana sauce, fresh mozzarella', 40.00, 0, 8),
('Italian Meat Lover',      'pizza', 'Italian Pizza', 'Napoletana sauce, mozzarella', 50.00, 1, 9),
('Bianca (White Pizza)',    'pizza', 'Italian Pizza', 'White sauce, mozzarella', 45.00, 0, 10),
('Truffle Steak Pizza',     'pizza', 'Italian Pizza', 'Truffle cream sauce, mozzarella', 60.00, 1, 11),
('Polpette Di Manzo',       'pizza', 'Italian Pizza', 'Napoletana sauce, mozzarella', 45.00, 0, 12),
('Salsiccia',               'pizza', 'Italian Pizza', 'Napoletana sauce, mozzarella', 50.00, 0, 13),
('Capricciosa',             'pizza', 'Italian Pizza', 'Napoletana sauce, mozzarella', 45.00, 0, 14);

-- ── Pizza — Sweet & Crispy Stuffed Crust Menu ────────────────
INSERT IGNORE INTO menu_items (name, category, subcategory, description, price_ec, is_signature, sort_order) VALUES
('Cheese Pizza',      'pizza', 'Stuffed Crust', 'Napoletana sauce, mozzarella', 40.00, 0, 21),
('Hawaiian Pizza',    'pizza', 'Stuffed Crust', 'Napoletana sauce, mozzarella', 45.00, 0, 22),
('Rustica Pizza',     'pizza', 'Stuffed Crust', 'Napoletana sauce, mozzarella', 45.00, 0, 23),
('Meat Lover Pizza',  'pizza', 'Stuffed Crust', 'Napoletana sauce, mozzarella', 55.00, 1, 24),
('Four Cheese Pizza', 'pizza', 'Stuffed Crust', 'Mozzarella, cheddar, parmesan', 55.00, 0, 25),
('Veggie Pizza',      'pizza', 'Stuffed Crust', 'Napoletana sauce, mozzarella', 49.00, 0, 26),
('BBQ Chicken',       'pizza', 'Stuffed Crust', 'BBQ sauce, mozzarella', 49.00, 0, 27),
('Pepperoni Pizza',   'pizza', 'Stuffed Crust', 'Napoletana sauce, mozzarella', 45.00, 1, 28),
('Bacon Pizza',       'pizza', 'Stuffed Crust', 'Napoletana sauce, mozzarella', 49.00, 0, 29),
('Diavola Pizza',     'pizza', 'Stuffed Crust', 'Napoletana sauce, mozzarella', 45.00, 0, 30),
('Sefaha (Arabic)',   'pizza', 'Stuffed Crust', 'Special spicy sauce, mozzarella', 35.00, 0, 31);

-- ── Food — Appetizers ────────────────────────────────────────
INSERT IGNORE INTO menu_items (name, category, subcategory, description, price_ec, is_signature, sort_order) VALUES
('Cheese Sticks',        'food', 'Appetizers', NULL, 25.00, 0, 1),
('Chicken Spring Rolls', 'food', 'Appetizers', NULL, 20.00, 0, 2),
('Cheese Chips',         'food', 'Appetizers', NULL, 20.00, 0, 3),
('Arabic Samosa',        'food', 'Appetizers', NULL, 20.00, 0, 4),
('Dynamite Shrimp',      'food', 'Appetizers', NULL, 27.00, 1, 5),
('Garlic Bread',         'food', 'Appetizers', NULL, 20.00, 0, 6),
('Finger & Fries',       'food', 'Appetizers', NULL, 35.00, 0, 7),
('Wings',                'food', 'Appetizers', NULL, 30.00, 0, 8),
('Crispy Strips',        'food', 'Appetizers', NULL, 35.00, 0, 9);

-- ── Food — Meals ─────────────────────────────────────────────
INSERT IGNORE INTO menu_items (name, category, subcategory, description, price_ec, is_signature, sort_order) VALUES
('Beef Strognaoff',      'food', 'Meals', 'Beef steak, onion, mushroom', 50.00, 0, 11),
('Beef Bulgogi Meal',    'food', 'Meals', 'Beef steak, onion, peppers', 50.00, 1, 12),
('Salmon Meal',          'food', 'Meals', 'Grilled salmon', 55.00, 0, 13),
('Chicken Cutlet Meal',  'food', 'Meals', 'Fried chicken', 35.00, 0, 14),
('Pork Cutlet Meal',     'food', 'Meals', 'Fried pork tenderloin', 35.00, 0, 15),
('Beef Kebab Meal',      'food', 'Meals', 'Kebab sticks, salad', 40.00, 0, 16),
('Shish Tawouk Meal',    'food', 'Meals', 'Chicken shish, veggie', 40.00, 0, 17),
('Toshka Meal',          'food', 'Meals', 'Pita bread stuffed', 40.00, 0, 18),
('Falafel (Veggie) Meal','food', 'Meals', 'Falafel, hummus, pickles', 40.00, 0, 19),
('Veggie Chow Mein',     'food', 'Meals', NULL, 30.00, 0, 20),
('Chicken Chow Mein',    'food', 'Meals', NULL, 35.00, 0, 21),
('Beef Chow Mein',       'food', 'Meals', NULL, 40.00, 0, 22),
('Shrimp Chow Mein',     'food', 'Meals', NULL, 40.00, 0, 23);

-- ── Food — Salads ────────────────────────────────────────────
INSERT IGNORE INTO menu_items (name, category, subcategory, description, price_ec, is_signature, sort_order) VALUES
('Caesar Salad',       'food', 'Salads', 'Lettuce, chicken, toast', 35.00, 0, 31),
('Greek Salad',        'food', 'Salads', 'Lettuce, tomato, cucumber', 32.00, 0, 32),
('Chinese Crab Salad', 'food', 'Salads', 'Crab, lettuce, carrot', 35.00, 0, 33),
('French Salad',       'food', 'Salads', 'Lettuce, corn, mushroom', 35.00, 0, 34),
('Tuna Salad',         'food', 'Salads', 'Lettuce, tuna, tomato', 35.00, 0, 35),
('Corn Salad',         'food', 'Salads', 'Lettuce, tomato, peppers', 30.00, 0, 36),
('Rocca Salad',        'food', 'Salads', 'Lettuce, rocca, tomato', 35.00, 0, 37),
('Doritos Salad',      'food', 'Salads', 'Cabbage, red cabbage', 35.00, 0, 38),
('Fattoush Salad',     'food', 'Salads', 'Cucumber, tomato', 35.00, 0, 39),
('Tabbouleh Salad',    'food', 'Salads', 'Parsley, tomato, quinoa', 30.00, 0, 40);

-- ── Food — Pastas ────────────────────────────────────────────
INSERT IGNORE INTO menu_items (name, category, subcategory, description, price_ec, is_signature, sort_order) VALUES
('Pink Sauce Pasta',      'food', 'Pastas', 'Creamy sauce with broccoli', 40.00, 0, 51),
('Red Sauce Pasta',       'food', 'Pastas', 'Napoletana, mozzarella', 40.00, 0, 52),
('White Sauce (Alfredo)', 'food', 'Pastas', 'Mushroom, broccoli', 40.00, 0, 53),
('Alfredo Pesto Mix',     'food', 'Pastas', 'Mushroom, broccoli', 45.00, 0, 54),
('Green Sauce (Pesto)',   'food', 'Pastas', 'Mushroom, broccoli', 40.00, 0, 55),
('Spaghetti Bolognese',   'food', 'Pastas', 'Red sauce, minced beef', 35.00, 0, 56),
('Pomodoro Veggie',       'food', 'Pastas', 'Fresh tomato, olive oil', 35.00, 0, 57),
('Salmon Pasta',          'food', 'Pastas', 'White sauce with salmon', 50.00, 0, 58);

-- ── Food — Sandwiches ────────────────────────────────────────
INSERT IGNORE INTO menu_items (name, category, subcategory, description, price_ec, is_signature, sort_order) VALUES
('Philadelphia Sandwich',  'food', 'Sandwiches', 'Beef steak, onion, mushroom', 40.00, 0, 61),
('Chicken Oregano',        'food', 'Sandwiches', 'Chicken with oregano', 35.00, 0, 62),
('Steak Sandwich',         'food', 'Sandwiches', 'Beef steak, mushroom', 40.00, 0, 63),
('Fajita Sandwich',        'food', 'Sandwiches', 'Chicken, colorful peppers', 35.00, 0, 64),
('Club Sandwich',          'food', 'Sandwiches', 'Layers of toast, chicken', 40.00, 0, 65),
('Mexican Spicy Sandwich', 'food', 'Sandwiches', 'Grilled chicken, spicy', 40.00, 0, 66);

-- ── Food — Burgers ───────────────────────────────────────────
INSERT IGNORE INTO menu_items (name, category, subcategory, description, price_ec, is_signature, sort_order) VALUES
('Smash Burger',           'food', 'Burgers', '3 patties + 2 slices of cheese', 38.00, 1, 71),
('Big Mac Burger',         'food', 'Burgers', '2 patties + egg, spicy sauce', 37.00, 0, 72),
('Juicy Lucy Burger',      'food', 'Burgers', 'Pattie + caramelized onion', 35.00, 0, 73),
('Monster Burger',         'food', 'Burgers', 'Fry homemade chicken', 35.00, 0, 74),
('Mixicano Fire',          'food', 'Burgers', '2 fry spicy chicken, jalapeno', 40.00, 0, 75),
('Zinger Burger',          'food', 'Burgers', 'Fry chicken pattie + salad', 37.00, 0, 76),
('Aloha Burger',           'food', 'Burgers', 'Beef pattie + pineapple', 35.00, 0, 77),
('Regular Chicken Burger', 'food', 'Burgers', 'Fry chicken, lettuce', 35.00, 0, 78);

-- ── Food — Wraps ─────────────────────────────────────────────
INSERT IGNORE INTO menu_items (name, category, subcategory, description, price_ec, is_signature, sort_order) VALUES
('Sweet Crispy Wraps', 'food', 'Wraps', 'Fry chicken + rocca', 35.00, 1, 81),
('Volcano Wraps',      'food', 'Wraps', 'Grill chicken + rocca', 35.00, 0, 82),
('Kebab Wraps',        'food', 'Wraps', 'Beef kebab + red onion', 35.00, 0, 83),
('Shish Wraps',        'food', 'Wraps', 'Fries + chicken shish', 35.00, 0, 84),
('Falafel Wraps',      'food', 'Wraps', 'Falafel + cucumber', 30.00, 0, 85),
('Lamb Wraps',         'food', 'Wraps', 'Lettuce + lamb + onion', 35.00, 0, 86);

-- ── Food — Fries & Sides ─────────────────────────────────────
INSERT IGNORE INTO menu_items (name, category, subcategory, description, price_ec, is_signature, sort_order) VALUES
('Cheese Fries',      'food', 'Fries & Sides', 'Cheese sauce', 16.00, 0, 91),
('Loaded Fries',      'food', 'Fries & Sides', 'Fries + crispy chicken', 36.00, 0, 92),
('Batata Harra',      'food', 'Fries & Sides', 'Diced fried potatoes', 17.00, 0, 93),
('Batata Coriander',  'food', 'Fries & Sides', 'Diced fried coriander fries', 18.00, 0, 94),
('Home Made Wedges',  'food', 'Fries & Sides', NULL, 16.00, 0, 95),
('Crispy Fries',      'food', 'Fries & Sides', 'Homemade crispy pot', 18.00, 0, 96),
('Regular Fries',     'food', 'Fries & Sides', NULL, 12.00, 0, 97);

-- ── Food — Drinks ────────────────────────────────────────────
INSERT IGNORE INTO menu_items (name, category, subcategory, description, price_ec, is_signature, sort_order) VALUES
('Sprite',            'food', 'Drinks', NULL, 6.00,  0, 101),
('Coke',              'food', 'Drinks', NULL, 6.00,  0, 102),
('Diet Coke',         'food', 'Drinks', NULL, 6.00,  0, 103),
('Ginger Ale',        'food', 'Drinks', NULL, 6.00,  0, 104),
('Orange Fanta',      'food', 'Drinks', NULL, 6.00,  0, 105),
('Grape Fanta',       'food', 'Drinks', NULL, 6.00,  0, 106),
('Dr. Pepper',        'food', 'Drinks', NULL, 7.00,  0, 107),
('Carib',             'food', 'Drinks', NULL, 7.00,  0, 108),
('Stag',              'food', 'Drinks', NULL, 7.00,  0, 109),
('Arizona',           'food', 'Drinks', 'Green tea or iced tea', 9.00, 0, 110),
('Gatorade',          'food', 'Drinks', 'Blue or yellow or red', 9.00, 0, 111),
('Caribe - Rose',     'food', 'Drinks', NULL, 9.00,  0, 112),
('Caribe - Mimosa',   'food', 'Drinks', NULL, 9.00,  0, 113),
('Caribe - Pearsecco','food', 'Drinks', NULL, 9.00,  0, 114),
('Monster',           'food', 'Drinks', NULL, 12.00, 0, 115);
