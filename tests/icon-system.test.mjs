import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIconElement, ensureIconElement } from '../apps/core-extension/dist/index.js';
import { FakeDocument, FakeElement, installFakeDomGlobals } from './helpers/fake-dom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('isolated Font Awesome asset is current and never exposes global fa selectors', () => {
  execFileSync(process.execPath, ['scripts/generate-icons.mjs', '--check'], { cwd: root, stdio: 'pipe' });
  const css = readFileSync(path.join(root, 'public/fontawesome/ss-helper-icons.css'), 'utf8');
  assert.match(css, /font-family: 'SS Helper Font Awesome 7 Pro'/u);
  assert.match(css, /ss-helper-icon\[name="brain"\].*'\\f5dc'/u);
  assert.match(css, /ss-helper-icon\[name="microchip"\].*'\\f2db'/u);
  assert.doesNotMatch(css, /(^|[,}\s])\.fa-/mu);
  assert.doesNotMatch(css, /:root/u);
});

test('browser loader resolves the artifact manifest from the plugin root', () => {
  const loader = readFileSync(path.join(root, 'server-plugin/browser/core.js'), 'utf8');
  assert.match(loader, /new URL\('\.\.\/artifact-manifest\.json', import\.meta\.url\)/u);
  assert.match(loader, /document\?\.artifacts\?\.\['SS-Helper-SDK'\]\?\.contentDigest/u);
});

test('chat indicators reserve the full fixed-width icon box', () => {
  const styles = readFileSync(path.join(root, 'apps/core-extension/src/styles/settings-styles.ts'), 'utf8');
  assert.match(styles, /\[data-ss-helper-chat-indicator-plugin\]\s*\{\s*\n\s*position: relative; width: 1\.25em; height: 1\.25em;/u);
});

test('icon factory provides isolated markup and accessible semantics', () => {
  const document = new FakeDocument();
  const semantic = createIconElement(document, 'Brain', { label: '记忆插件', fixedWidth: true });
  assert.equal(semantic.tagName, 'SS-HELPER-ICON');
  assert.equal(semantic.getAttribute('name'), 'brain');
  assert.equal(semantic.getAttribute('role'), 'img');
  assert.equal(semantic.getAttribute('aria-label'), '记忆插件');
  assert.equal(semantic.hasAttribute('fixed-width'), true);
  const decorative = createIconElement(document, 'microchip', { decorative: true });
  assert.equal(decorative.getAttribute('aria-hidden'), 'true');
  assert.equal(decorative.getAttribute('role'), null);
  const invalid = createIconElement(document, 'bad name', { decorative: true });
  assert.equal(invalid.getAttribute('data-ss-helper-icon-invalid'), 'true');
});

test('custom element registration is idempotent and degrades without a registry', () => {
  const restore = installFakeDomGlobals();
  try {
    const definitions = new Map();
    const document = new FakeDocument();
    document.defaultView = {
      HTMLElement: FakeElement,
      customElements: {
        get: (name) => definitions.get(name),
        define: (name, constructor) => {
          if (definitions.has(name)) throw new Error('duplicate');
          definitions.set(name, constructor);
        },
      },
    };
    assert.equal(ensureIconElement(document), true);
    assert.equal(ensureIconElement(document), true);
    assert.equal(definitions.size, 1);
    assert.equal(ensureIconElement(new FakeDocument()), false);
  } finally { restore(); }
});
