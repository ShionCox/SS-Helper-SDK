export class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.id = '';
    this.textContent = '';
    this.disabled = false;
    this.value = '';
    this.checked = false;
    this.type = '';
    this.tabIndex = 0;
  }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  prepend(...nodes) { for (const node of [...nodes].reverse()) { node.parentElement = this; this.children.unshift(node); } }
  replaceChildren(...nodes) { for (const child of this.children) child.parentElement = undefined; this.children = []; this.append(...nodes); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((node) => node !== this); this.parentElement = undefined; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'id') this.id = String(value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name) || (name === 'disabled' && this.disabled); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, listener) { const entries = this.listeners.get(type) ?? new Set(); entries.add(listener); this.listeners.set(type, entries); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatchEvent(event) { event.target ??= this; for (const listener of this.listeners.get(event.type) ?? []) listener(event); }
  focus() { this.ownerDocument.activeElement = this; }
  querySelectorAll(selector) {
    const candidates = [];
    const visit = (node) => { for (const child of node.children) { candidates.push(child); visit(child); } };
    visit(this);
    if (selector.includes('button')) return candidates.filter((node) => ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A'].includes(node.tagName) || node.attributes.has('tabindex'));
    if (selector.startsWith('[data-')) return candidates.filter((node) => Object.keys(node.dataset).length > 0);
    return candidates;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

export class FakeDocument {
  constructor() { this.body = new FakeElement('body', this); this.activeElement = this.body; }
  createElement(tagName) { return new FakeElement(tagName, this); }
  getElementById(id) {
    let found = null;
    const visit = (node) => { if (node.id === id) found = node; for (const child of node.children) visit(child); };
    visit(this.body);
    return found;
  }
}

export function installFakeDomGlobals() {
  const previous = globalThis.HTMLElement;
  globalThis.HTMLElement = FakeElement;
  return () => { if (previous === undefined) delete globalThis.HTMLElement; else globalThis.HTMLElement = previous; };
}
