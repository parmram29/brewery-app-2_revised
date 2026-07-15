-- ============================================================
-- Sweet & Crispy — Database Schema
-- Family-run pizzeria & kitchen, Grenada
-- Run once:  mysql -u root -p < db/schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS sweet_crispy
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE sweet_crispy;

-- ── Menu items ────────────────────────────────────────────────
-- category: 'pizza' or 'food' — the two ordering tabs on the site.
-- subcategory: display grouping within a tab (e.g. "Stuffed Crust", "Burgers").
-- price_large_ec is only used by items that offer a Medium/Large size (stuffed crust pizzas).
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
  created_at     TIMESTAMP      DEFAULT CURRENT_TIMESTAMP
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
  stripe_session_id VARCHAR(255) NULL,
  paid_at          TIMESTAMP     NULL,
  created_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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

-- ── Reservations ─────────────────────────────────────────────
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
-- Seed: full Sweet & Crispy menu (56 items)
-- ============================================================

-- Pizza — Italian Pizza Menu (12")
INSERT INTO menu_items (name, category, subcategory, description, price_ec, is_signature, sort_order) VALUES
('Ortoland (Veggie)',        'pizza', 'Italian Pizza', 'Napoletana sauce, mozzarella, eggplant, fresh tomato, onion, artichoke, basil', 45.00, 0, 1),
('Spicy Elegant Chicken',    'pizza', 'Italian Pizza', 'Napoletana sauce, mozzarella, spicy chicken, mozzarella sticks', 45.00, 0, 2),
('Margherita',                'pizza', 'Italian Pizza', 'Napoletana sauce, fresh mozzarella, basil', 40.00, 1, 3),
('Alfredo Chicken (or Shrimp)','pizza','Italian Pizza', 'Alfredo sauce, fresh mozzarella, chicken or shrimp, mushrooms, rocca, basil', 50.00, 0, 4),
('Buffalo Chicken',           'pizza', 'Italian Pizza', 'Napoletana sauce, mozzarella, buffalo chicken, jalapeño', 45.00, 0, 5),
('Salsiccia',                 'pizza', 'Italian Pizza', 'Napoletana sauce, mozzarella, Italian sausage, onion, peppers', 50.00, 0, 6),
('Prosciutto',                'pizza', 'Italian Pizza', 'Napoletana sauce, mozzarella, duck ham, arugula, cherry tomatoes', 50.00, 0, 7),
('Carciofi',                  'pizza', 'Italian Pizza', 'Pesto sauce, mozzarella, artichokes, asparagus, parmesan, basil', 50.00, 0, 8),
('Caprese',                   'pizza', 'Italian Pizza', 'Napoletana sauce, fresh mozzarella, cherry tomatoes, basil, fresh garlic, halloumi cheese', 40.00, 0, 9),
('Italian Meat Lover',        'pizza', 'Italian Pizza', 'Napoletana sauce, mozzarella, salami, ham, pepperoni, prosciutto', 50.00, 1, 10),
('Capricciosa',               'pizza', 'Italian Pizza', 'Napoletana sauce, mozzarella, ham, mushrooms, olives, artichokes', 45.00, 0, 11),
('Bianca (White Pizza)',      'pizza', 'Italian Pizza', 'White sauce, mozzarella, rocca, gorgonzola, basil, fresh garlic, olive oil', 45.00, 0, 12),
('Truffle Steak',             'pizza', 'Italian Pizza', 'Truffle cream sauce, mozzarella, grilled steak, mushrooms', 60.00, 1, 13),
('Polpette di Manzo',         'pizza', 'Italian Pizza', 'Napoletana sauce, mozzarella, beef meatball, onion, basil', 45.00, 0, 14);

-- Pizza — Stuffed Crust Menu (Medium / Large)
INSERT INTO menu_items (name, category, subcategory, description, price_ec, price_large_ec, is_signature, sort_order) VALUES
('Cheese',       'pizza', 'Stuffed Crust', 'Napoletana sauce, mozzarella', 40.00, 70.00, 0, 21),
('Hawaiian',      'pizza', 'Stuffed Crust', 'Napoletana sauce, mozzarella, turkey ham, pineapple', 45.00, 75.00, 0, 22),
('Rustica',       'pizza', 'Stuffed Crust', 'Napoletana sauce, mozzarella, sliced tomatoes, feta cheese', 45.00, 80.00, 0, 23),
('Meat Lover',    'pizza', 'Stuffed Crust', 'Napoletana sauce, mozzarella, salami, ham, pepperoni, sausage', 55.00, 85.00, 1, 24),
('Four Cheese',   'pizza', 'Stuffed Crust', 'Mozzarella, cheddar, parmesan, gorgonzola', 55.00, 80.00, 0, 25),
('Veggie',        'pizza', 'Stuffed Crust', 'Napoletana sauce, mozzarella, mushrooms, onions, peppers, olives, spinach', 49.00, 82.00, 0, 26),
('BBQ Chicken',   'pizza', 'Stuffed Crust', 'BBQ sauce, mozzarella, chicken, onion, peppers', 49.00, 75.00, 0, 27),
('Pepperoni',     'pizza', 'Stuffed Crust', 'Napoletana sauce, mozzarella, pepperoni', 45.00, 75.00, 1, 28),
('Bacon',         'pizza', 'Stuffed Crust', 'Napoletana sauce, mozzarella, pork bacon', 49.00, 75.00, 0, 29),
('Diavola',       'pizza', 'Stuffed Crust', 'Napoletana sauce, mozzarella, spicy salami, black olives', 45.00, 80.00, 0, 30),
('Sefaha (Arabic)','pizza','Stuffed Crust', 'Special spicy sauce, mozzarella, ground beef with onions & spices', 35.00, 55.00, 0, 31);

-- Food — Pasta
INSERT INTO menu_items (name, category, subcategory, description, price_ec, is_signature, sort_order) VALUES
('Pink Sauce (Cremosa)', 'food', 'Pasta', 'Creamy tomato sauce with broccoli — ask to add shrimp', 40.00, 0, 1),
('Red Sauce',            'food', 'Pasta', 'Tomato sauce, mozzarella, mushroom', 35.00, 0, 2),
('White Sauce (Alfredo)','food', 'Pasta', 'Alfredo sauce, mushroom, broccoli', 40.00, 0, 3),
('Alfredo Pesto Mix',    'food', 'Pasta', 'Alfredo & pesto blend, mushroom, broccoli', 45.00, 0, 4),
('Green Sauce (Pesto)',  'food', 'Pasta', 'Pesto sauce, mushroom, broccoli', 40.00, 0, 5),
('Aiolio Tuna',          'food', 'Pasta', 'Garlic aioli, tuna, mushroom, broccoli', 35.00, 0, 6),

-- Food — Chowmein Stir Fry Noodles
('Veggie Chowmein',           'food', 'Chowmein', 'Stir-fried noodles with fresh vegetables', 30.00, 0, 11),
('Chicken Chowmein',          'food', 'Chowmein', 'Stir-fried noodles with chicken', 35.00, 0, 12),
('Shrimp Chowmein',           'food', 'Chowmein', 'Stir-fried noodles with shrimp', 35.00, 0, 13),
('Combo Chicken Chowmein',    'food', 'Chowmein', 'Chicken chowmein with 2pc egg roll or dumpling', 35.00, 0, 14),
('Combo Veggie Chowmein',     'food', 'Chowmein', 'Veggie chowmein with 2pc egg roll or dumpling', 35.00, 0, 15),

-- Food — Sandwiches (served with wedges)
('Steak Sandwich',      'food', 'Sandwiches', 'Fresh mushroom, beef steak, cheese — served with wedges', 35.00, 0, 21),
('Chicken Fajita',      'food', 'Sandwiches', 'Chicken, green/yellow/red peppers — served with wedges', 35.00, 0, 22),
('Club Sandwich',       'food', 'Sandwiches', 'Chicken, bacon, egg, tomato, cheese — served with wedges', 35.00, 0, 23),
('Lamb Sub Sandwich',   'food', 'Sandwiches', 'Lamb, lettuce, tomato, cheese — served with wedges', 35.00, 0, 24),

-- Food — Burgers (served with fries)
('Aloha Burger',    'food', 'Burgers', 'Beef, pineapple, lettuce, tomato, cheese — served with fries', 35.00, 0, 31),
('Juicy Lucy',      'food', 'Burgers', 'Beef, caramelised onion, lettuce, tomato, cheese — served with fries', 35.00, 1, 32),
('Regular Burger',  'food', 'Burgers', 'Beef, cheese, lettuce, tomato — served with fries', 35.00, 0, 33),
('Chicken Burger',  'food', 'Burgers', 'Fried chicken breast, cheese, lettuce, tomato — served with fries', 35.00, 0, 34),

-- Food — Meals (Korean-style plates)
('Beef Bulgogi',    'food', 'Meals', 'Beef steak, white rice, sautéed veggies', 50.00, 1, 41),
('Chicken Cutlet',  'food', 'Meals', 'White rice, breaded chicken fry, sautéed veggies, sauce', 35.00, 0, 42),
('Pork Cutlet',     'food', 'Meals', 'White rice, breaded pork fry, sautéed veggies, sauce', 35.00, 0, 43),

-- Food — Appetizers
('Egg Roll (Lumpia) — 4pcs',      'food', 'Appetizers', 'Crispy chicken egg rolls', 20.00, 0, 51),
('Dumpling (Siomai) — 5pcs',      'food', 'Appetizers', 'Steamed chicken dumplings', 25.00, 0, 52),
('Wings',                          'food', 'Appetizers', 'Classic, BBQ, sweet & sour, sweet & chilli, buttered honey garlic, or buffalo', 25.00, 0, 53),
('Dynamite Shrimp — 5pcs',        'food', 'Appetizers', 'Crispy shrimp, dynamite sauce', 25.00, 0, 54),
('Chicken Fingers & Fries',        'food', 'Appetizers', 'Breaded chicken fingers, side of fries', 35.00, 0, 55),
('Fries (Regular)',                'food', 'Appetizers', 'Classic seasoned fries', 12.00, 0, 56),
('Cheese Fries',                   'food', 'Appetizers', 'Fries topped with melted cheese', 14.00, 0, 57),
('Spicy Fries',                    'food', 'Appetizers', 'Fries tossed in house spicy seasoning', 15.00, 0, 58),
('Wedges',                          'food', 'Appetizers', 'Seasoned potato wedges', 16.00, 0, 59);
