// ============================================================
// Loads and holds the read-only menu. One instance is shared by every
// page that needs to browse or look up items.
//
// The menu comes from a static file (data/menu.js), not the database —
// this is intentional. The site has no backend calls left at all for
// customers: the menu rarely changes, so it lives in code and ships
// with every deploy. Card payments are gone too (WhatsApp + cash is the
// only ordering path now), so cardPaymentsEnabled is always false.
// ============================================================

import { MENU_ITEMS } from '../data/menu.js';
import { WHATSAPP_NUMBER } from '../config.js';

export class MenuStore {
  constructor() {
    this.items = [];
    this.cardPaymentsEnabled = false;
    this.whatsapp = WHATSAPP_NUMBER;
    this._loaded = false;
    this.loadError = null;
  }

  async load() {
    if (this._loaded) return;
    this.items = MENU_ITEMS;
    this._loaded = true;
    this.loadError = null;
  }

  byId(id) { return this.items.find(i => i.id === id); }

  byCategory(category) { return this.items.filter(i => i.category === category); }

  subcategoriesOf(category) {
    return [...new Set(this.byCategory(category).map(i => i.subcategory))];
  }

  signaturePicks(limit = 6) {
    return this.items.filter(i => i.is_signature).slice(0, limit);
  }
}
