// ============================================================
// Minimal client-side router for the three top-level pages
// (home / about / pay) plus the hidden admin page. Pages register
// an onEnter callback that runs every time the router switches to
// them, so each page class owns its own render/refresh logic.
// ============================================================

export class Router {
  constructor(pageOrder) {
    this.pageOrder = pageOrder; // ['home','about','pay'] — drives nav-btn highlighting
    this.handlers = new Map();  // page name -> callback run on enter
    this.current = null;
  }

  onEnter(page, callback) { this.handlers.set(page, callback); }

  goTo(page, payload) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');

    const idx = this.pageOrder.indexOf(page);
    if (idx >= 0) document.querySelectorAll('.nav-btn')[idx]?.classList.add('active');

    document.getElementById('nav-links').classList.remove('open');
    this.current = page;
    this.handlers.get(page)?.(payload);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Convenience for "go to the Pay page, already on the Order or Reserve tab." */
  goToPay(section) { this.goTo('pay', { section }); }

  toggleMobileNav() {
    document.getElementById('nav-links').classList.toggle('open');
  }
}
