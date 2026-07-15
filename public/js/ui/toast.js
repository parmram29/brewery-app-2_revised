// ============================================================
// Tiny toast notification, backed by the single #toast element.
// ============================================================

export class Toast {
  constructor(elementId = 'toast') {
    this.el = document.getElementById(elementId);
  }

  show(message, type) {
    this.el.textContent = message;
    this.el.className = 'toast in' + (type ? ' ' + type : '');
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.el.classList.remove('in'), 3200);
  }
}
