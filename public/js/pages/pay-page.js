import { footerHtml, bindFooterNav } from '../ui/footer.js';

/** Owns the Order page's footer/menu-load bootstrapping. */
export class PayPage {
  constructor({ orderPage, menuStore, router }) {
    this.orderPage = orderPage;
    this.menuStore = menuStore;
    bindFooterNav('pay-footer', router);
  }

  async onEnter() {
    await this.menuStore.load();
    this.orderPage.render();
    document.getElementById('pay-footer').innerHTML = footerHtml(this.menuStore.whatsapp);
  }
}
