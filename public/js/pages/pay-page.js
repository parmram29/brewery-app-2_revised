import { footerHtml } from '../ui/footer.js';

/** Owns the Order page's footer/menu-load bootstrapping. */
export class PayPage {
  constructor({ orderPage, menuStore }) {
    this.orderPage = orderPage;
    this.menuStore = menuStore;
  }

  async onEnter() {
    await this.menuStore.load();
    this.orderPage.render();
    document.getElementById('pay-footer').innerHTML = footerHtml(this.menuStore.whatsapp);
  }
}
