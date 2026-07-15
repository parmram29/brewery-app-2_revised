import { footerHtml } from '../ui/footer.js';

/** Owns the "Order Food" / "Reserve a Table" tab switch on the Pay page. */
export class PayPage {
  constructor({ orderPage, reservePage, menuStore }) {
    this.orderPage = orderPage;
    this.reservePage = reservePage;
    this.menuStore = menuStore;

    document.querySelector('.pay-switch').addEventListener('click', (e) => {
      const t = e.target.closest('[data-action="switch-pay"]');
      if (t) this.switchTab(t.dataset.section);
    });
  }

  async onEnter(payload) {
    await this.menuStore.load();
    this.switchTab(payload?.section || 'order');
    document.getElementById('pay-footer').innerHTML = footerHtml(this.menuStore.whatsapp);
  }

  switchTab(section) {
    document.getElementById('pay-tab-order').classList.toggle('on', section === 'order');
    document.getElementById('pay-tab-reserve').classList.toggle('on', section === 'reserve');
    document.getElementById('pay-order').classList.toggle('on', section === 'order');
    document.getElementById('pay-reserve').classList.toggle('on', section === 'reserve');
    if (section === 'order') this.orderPage.render(); else this.reservePage.render();
  }
}
