import { waLink, WA_ICON_SVG } from '../services/whatsapp.js';

/** Same footer markup rendered into #home-footer / #about-footer / #pay-footer. */
export function footerHtml(whatsapp) {
  return `
  <footer>
    <div class="footer-grid">
      <div>
        <h4>Sweet &amp; Crispy</h4>
        <p class="foot-sub">A family-run kitchen in true blue Grenada. Wood-fired pizza &amp; island favourites, made simple.</p>
        <a class="wa-btn" href="${waLink(whatsapp, 'Hi Sweet & Crispy!')}" target="_blank" rel="noopener">${WA_ICON_SVG} WhatsApp Us</a>
      </div>
      <div>
        <h5>Visit</h5>
        <div class="foot-line">Grenada, West Indies</div>
        <div class="foot-line">Mon–Thu 11am–9:30pm<br>Fri–Sat 11am–10:30pm · Sun 12–9pm</div>
      </div>
      <div>
        <h5>Get In Touch</h5>
        <div class="foot-line" data-action="go-to" data-page="pay" style="cursor:pointer">Order &amp; Reserve →</div>
        <div class="foot-line" data-action="go-to" data-page="about" style="cursor:pointer">About &amp; Contact →</div>
      </div>
    </div>
    <div class="foot-bottom">
      <span>© ${new Date().getFullYear()} Sweet &amp; Crispy. All rights reserved.</span>
      <span>Made with family recipes, Grenada.</span>
    </div>
  </footer>`;
}
