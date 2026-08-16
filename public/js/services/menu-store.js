// ============================================================
// Loads and holds the read-only menu + payment config. One instance
// is shared by every page that needs to browse or look up items.
//
// The menu itself comes from a static file (data/menu.js), not the
// database — this is intentional. The site is being weaned off the
// database entirely; the menu rarely changes, so it lives in code and
// ships with every deploy instead of depending on a live DB connection
// that a small hosted MySQL plan can't reliably hold up under load.
// Only /api/payments/config is still fetched — it's env-var-only,
// touches no database, and tells the frontend whether card payments
// are enabled.
// ============================================================

import { MENU_ITEMS } from '../data/menu.js';

export class MenuStore {
  constructor(api) {
    this.api = api;
    this.items = [];
    this.cardPaymentsEnabled = false;
    this.whatsapp = '14735369931';
    this._loaded = false;
    this.loadError = null;
  }

  async load() {
    if (this._loaded) return;
    this.items = MENU_ITEMS;
    this._loaded = true;
    this.loadError = null;

    const cfgRes = await this.api.get('/api/payments/config');
    if (cfgRes.ok) {
      this.cardPaymentsEnabled = cfgRes.cardPaymentsEnabled;
      if (cfgRes.whatsapp) this.whatsapp = cfgRes.whatsapp;
    }
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
