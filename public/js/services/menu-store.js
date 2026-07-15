// ============================================================
// Loads and holds the read-only menu + payment config. One instance
// is shared by every page that needs to browse or look up items.
// ============================================================

export class MenuStore {
  constructor(api) {
    this.api = api;
    this.items = [];
    this.cardPaymentsEnabled = false;
    this.whatsapp = '14735369931';
    this._loaded = false;
  }

  async load() {
    if (this._loaded) return;
    const [menuRes, cfgRes] = await Promise.all([
      this.api.get('/api/menu'),
      this.api.get('/api/payments/config'),
    ]);
    if (menuRes.ok) this.items = menuRes.items;
    if (cfgRes.ok) {
      this.cardPaymentsEnabled = cfgRes.cardPaymentsEnabled;
      if (cfgRes.whatsapp) this.whatsapp = cfgRes.whatsapp;
    }
    this._loaded = true;
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
