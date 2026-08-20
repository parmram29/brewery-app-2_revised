import { waLink } from '../services/whatsapp.js';
import { footerHtml, bindFooterNav } from '../ui/footer.js';

export class AboutPage {
  constructor({ menuStore, router }) {
    this.menuStore = menuStore;
    bindFooterNav('about-footer', router);
  }

  onEnter() {
    document.getElementById('directions-link').href =
      'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Sweet & Crispy, Grenada');
    document.getElementById('wa-link-about').href = waLink(this.menuStore.whatsapp, 'Hi Sweet & Crispy!');
    document.getElementById('about-footer').innerHTML = footerHtml(this.menuStore.whatsapp);
  }
}
