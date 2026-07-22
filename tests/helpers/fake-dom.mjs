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
    this.selected = false;
    this.multiple = false;
    this.type = '';
    this.tabIndex = 0;
    this.hidden = false;
    this.className = '';
    this.placeholder = '';
    this.name = '';
    this.min = '';
    this.max = '';
    this.step = '';
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.style = { overflow: '' };
    this.nodeType = 1;
    this.classList = { contains: (name) => this.className.split(/\s+/u).includes(name) };
  }
  append(...nodes) { for (const node of nodes) { if (node.parentElement) node.parentElement.children = node.parentElement.children.filter((child) => child !== node); node.parentElement = this; this.children.push(node); } }
  prepend(...nodes) { for (const node of [...nodes].reverse()) { node.parentElement = this; this.children.unshift(node); } }
  after(...nodes) { if (!this.parentElement) return; let index = this.parentElement.children.indexOf(this) + 1; for (const node of nodes) { if (node.parentElement) node.parentElement.children = node.parentElement.children.filter((child) => child !== node); node.parentElement = this.parentElement; this.parentElement.children.splice(index, 0, node); index += 1; } }
  replaceChildren(...nodes) { for (const child of this.children) child.parentElement = undefined; this.children = []; this.append(...nodes); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((node) => node !== this); this.parentElement = undefined; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'id') this.id = String(value); if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = String(value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name) || (name === 'disabled' && this.disabled); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, listener) { const entries = this.listeners.get(type) ?? new Set(); entries.add(listener); this.listeners.set(type, entries); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatchEvent(event) { event.target ??= this; for (const listener of this.listeners.get(event.type) ?? []) { event.currentTarget = this; listener(event); } event.currentTarget = null; }
  focus() { this.ownerDocument.activeElement = this; }
  contains(node) { if (node === this) return true; return this.children.some((child) => child.contains(node)); }
  get previousElementSibling() { if (!this.parentElement) return null; const index = this.parentElement.children.indexOf(this); return index > 0 ? this.parentElement.children[index - 1] : null; }
  matches(selector) {
    if (selector.includes(',')) return selector.split(',').some((part) => this.matches(part.trim()));
    if (selector === '.recentChat[data-file]') return this.classList.contains('recentChat') && this.dataset.file !== undefined;
    if (selector === '.recentChatList') return this.classList.contains('recentChatList');
    if (selector === '[data-ss-helper-chat-indicators="true"]') return this.dataset.ssHelperChatIndicators === 'true';
    if (selector === '[data-ss-helper-chat-indicator-plugin]') return this.dataset.ssHelperChatIndicatorPlugin !== undefined;
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (/^[a-z][a-z0-9-]*$/iu.test(selector)) return this.tagName === selector.toUpperCase();
    return false;
  }
  closest(selector) { let current = this; while (current) { if (current.matches(selector)) return current; current = current.parentElement; } return null; }
  querySelectorAll(selector) {
    const candidates = [];
    const visit = (node) => { for (const child of node.children) { candidates.push(child); visit(child); } };
    visit(this);
    if (selector === 'span:last-child') return candidates.filter((node) => node.tagName === 'SPAN' && node.parentElement?.children.at(-1) === node);
    if (selector === '.recentChat[data-file]' || selector === '[data-ss-helper-chat-indicators="true"]' || selector === '[data-ss-helper-chat-indicator-plugin]' || /^[a-z][a-z0-9-]*$/iu.test(selector)) return candidates.filter((node) => node.matches(selector));
    if (selector.startsWith('.')) return candidates.filter((node) => node.className.split(/\s+/u).includes(selector.slice(1)));
    if (selector.includes('button')) return candidates.filter((node) => ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A'].includes(node.tagName) || node.attributes.has('tabindex'));
    if (selector.startsWith('[data-')) return candidates.filter((node) => Object.keys(node.dataset).length > 0);
    return candidates;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

export class FakeDocument {
  constructor() {
    this.body = new FakeElement('body', this);
    this.activeElement = this.body;
    const listeners = new Map();
    this.defaultView = {
      confirm: () => true,
      addEventListener: (type, listener) => { const entries = listeners.get(type) ?? new Set(); entries.add(listener); listeners.set(type, entries); },
      removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
      dispatchEvent: (event) => { for (const listener of listeners.get(event.type) ?? []) listener(event); },
    };
  }
  createElement(tagName) { return new FakeElement(tagName, this); }
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
  querySelector(selector) { return this.body.querySelector(selector); }
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
