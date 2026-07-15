// ============================================================
// The shopping cart. Pure state + behaviour, no DOM — OrderPage
// renders whatever this holds. Kept deliberately dumb: it never
// invents a price, it only ever copies what MenuStore already
// resolved for a given item/size. The actual security boundary is
// server-side (routes/orders.js re-prices everything from the DB).
// ============================================================

export class Cart {
  constructor() {
    this.lines = [];
  }

  static keyFor(menuItemId, size) { return `${menuItemId}::${size || ''}`; }

  find(key) { return this.lines.find(l => l.key === key); }

  quantityOf(menuItemId, size) {
    const line = this.find(Cart.keyFor(menuItemId, size));
    return line ? line.quantity : 0;
  }

  add(menuItem, size) {
    const unitPrice = size === 'L' ? parseFloat(menuItem.price_large_ec) : parseFloat(menuItem.price_ec);
    const key = Cart.keyFor(menuItem.id, size);
    const existing = this.find(key);
    if (existing) { existing.quantity += 1; return; }
    this.lines.push({
      key, menu_item_id: menuItem.id, item_name: menuItem.name,
      size: size || null, unit_price: unitPrice, quantity: 1, special_instructions: '',
    });
  }

  changeQuantity(key, delta) {
    const line = this.find(key);
    if (!line) return;
    line.quantity += delta;
    if (line.quantity <= 0) this.remove(key);
  }

  remove(key) { this.lines = this.lines.filter(l => l.key !== key); }

  setNote(key, text) {
    const line = this.find(key);
    if (line) line.special_instructions = text.slice(0, 300);
  }

  get isEmpty() { return this.lines.length === 0; }

  get itemCount() { return this.lines.reduce((sum, l) => sum + l.quantity, 0); }

  get subtotal() { return this.lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0); }

  clear() { this.lines = []; }

  /** Shape expected by POST /api/orders — no price is ever included. */
  toOrderItems() {
    return this.lines.map(l => ({
      menu_item_id: l.menu_item_id,
      quantity: l.quantity,
      size: l.size,
      special_instructions: l.special_instructions || '',
    }));
  }
}
