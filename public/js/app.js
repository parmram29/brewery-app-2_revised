// ============================================================
// Application bootstrap. Wires the shared services (MenuStore, Cart,
// Toast) to the Router and each page class, then kicks off the initial
// render. This is the only file that knows about all the pieces —
// everything else only depends on what's passed into its constructor,
// so any page/service can be tested or reused on its own.
//
// No backend calls left for customers: the menu is a static file and
// checkout goes straight to WhatsApp (+ an optional Google Sheet log),
// so there's no ApiClient or Staff dashboard wired in here anymore.
// ============================================================

import { MenuStore } from './services/menu-store.js';
import { Cart } from './services/cart.js';
import { Toast } from './ui/toast.js';
import { Router } from './ui/router.js';
import { HomePage } from './pages/home-page.js';
import { AboutPage } from './pages/about-page.js';
import { OrderPage } from './pages/order-page.js';
import { PayPage } from './pages/pay-page.js';

class App {
  constructor() {
    this.menuStore = new MenuStore();
    this.cart = new Cart();
    this.toast = new Toast('toast');
    this.router = new Router(['home', 'about', 'pay']);

    this.homePage = new HomePage({ menuStore: this.menuStore, router: this.router });
    this.aboutPage = new AboutPage({ menuStore: this.menuStore, router: this.router });
    this.orderPage = new OrderPage({ menuStore: this.menuStore, cart: this.cart, toast: this.toast });
    this.payPage = new PayPage({ orderPage: this.orderPage, menuStore: this.menuStore, router: this.router });

    this.router.onEnter('home', () => this.homePage.onEnter());
    this.router.onEnter('about', () => this.aboutPage.onEnter());
    this.router.onEnter('pay', (payload) => this.payPage.onEnter(payload));

    this.bindNav();
  }

  // Single delegated listener for the top nav bar (logo, hamburger, links).
  bindNav() {
    document.querySelector('nav').addEventListener('click', (e) => {
      const t = e.target.closest('[data-action]');
      if (!t) return;
      if (t.dataset.action === 'go-to') this.router.goTo(t.dataset.page);
      if (t.dataset.action === 'toggle-nav') this.router.toggleMobileNav();
    });
  }

  async start() {
    await this.menuStore.load();
    this.homePage.renderSignaturePicks();
    document.getElementById('wa-float').href =
      `https://wa.me/${this.menuStore.whatsapp}?text=${encodeURIComponent('Hi Sweet & Crispy!')}`;
    document.getElementById('home-footer').innerHTML =
      (await import('./ui/footer.js')).footerHtml(this.menuStore.whatsapp);
  }
}

new App().start();
