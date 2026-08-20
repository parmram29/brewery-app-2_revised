import { money } from '../services/format.js';
import { waLink } from '../services/whatsapp.js';
import { footerHtml } from '../ui/footer.js';

export class HomePage {
  constructor({ menuStore, router }) {
    this.menuStore = menuStore;
    this.router = router;
    this.root = document.getElementById('page-home');

    this.root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'go-to-pay') this.router.goToPay(btn.dataset.section);
      if (btn.dataset.action === 'go-to') this.router.goTo(btn.dataset.page);
    });

    // Falls back to the hand-drawn illustration if no real photo has been
    // placed at public/images/hero-pizza.jpg yet.
    //
    // A plain addEventListener('error', ...) is a race on fast static
    // hosting: the image can finish loading (and failing) before this
    // deferred module script even runs, so the 'error' event fires and is
    // missed entirely, leaving the browser's default broken-image icon on
    // screen. img.complete + naturalWidth catches that already-settled
    // state too, on top of still listening for a future failure.
    this.wireImageFallback('hero-photo');
    this.wireImageFallback('story-photo');
  }

  wireImageFallback(id) {
    const img = document.getElementById(id);
    const showFallback = () => {
      img.style.display = 'none';
      img.nextElementSibling.style.display = 'flex';
    };
    if (img.complete) {
      if (img.naturalWidth === 0) showFallback();
    } else {
      img.addEventListener('error', showFallback, { once: true });
    }
  }

  async onEnter() {
    await this.menuStore.load();
    document.getElementById('wa-float').href = waLink(this.menuStore.whatsapp, 'Hi Sweet & Crispy!');
    this.renderSignaturePicks();
    document.getElementById('home-footer').innerHTML = footerHtml(this.menuStore.whatsapp);
  }

  renderSignaturePicks() {
    // Item count is driven off the loaded menu rather than a hard-coded
    // number, so it can never drift out of sync with the seed. This lives
    // here (not onEnter) because Home is already active on first paint, so
    // onEnter never fires for the initial load.
    const count = this.menuStore.items.length;
    if (count) {
      document.getElementById('hero-item-count').textContent = `🍕 ${count} items on the menu`;
    }

    const picks = this.menuStore.signaturePicks(6);
    document.getElementById('sig-grid').innerHTML = picks.map(i => `
      <div class="sig-card">
        <div class="tag">${i.category === 'pizza' ? '🍕 Pizza' : '🍽 Kitchen'}</div>
        <h4>${i.name}</h4>
        <p>${i.description || ''}</p>
        <div class="sig-price">${money(i.price_ec)}${i.price_large_ec ? ' – ' + money(i.price_large_ec) : ''}</div>
      </div>`).join('');
  }
}
