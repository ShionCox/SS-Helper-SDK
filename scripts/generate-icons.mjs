import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'public', 'fontawesome', 'fontawesome.css');
const outputPath = path.join(root, 'public', 'fontawesome', 'ss-helper-icons.css');
const FONT_FAMILY = 'SS Helper Font Awesome 7 Pro';

export function extractSolidIcons(source) {
  const icons = new Map();
  for (const match of source.matchAll(/([^{}]+)\{([^{}]+)\}/gu)) {
    const body = match[2] ?? '';
    const glyph = body.match(/--fa:\s*(['"])(\\[0-9a-f]{3,6})\1\s*;/iu)?.[2];
    if (!glyph) continue;
    for (const selector of (match[1] ?? '').matchAll(/\.fa-([a-z0-9]+(?:-[a-z0-9]+)*)/giu)) {
      const name = selector[1]?.toLowerCase();
      if (!name) continue;
      const previous = icons.get(name);
      if (previous !== undefined && previous !== glyph) throw new Error(`Font Awesome alias ${name} has conflicting glyphs`);
      icons.set(name, glyph);
    }
  }
  if (icons.size < 1000 || icons.get('brain') !== '\\f5dc' || icons.get('microchip') !== '\\f2db') {
    throw new Error('Font Awesome solid icon extraction was incomplete');
  }
  return new Map([...icons].sort(([left], [right]) => left.localeCompare(right, 'en')));
}

export function renderIsolatedIconCss(icons) {
  const mappings = [...icons].map(([name, glyph]) =>
    `ss-helper-icon[name="${name}"] { --ss-helper-icon-glyph: '${glyph}'; --ss-helper-icon-family: '${FONT_FAMILY}'; }`,
  );
  return [
    '/*! Generated from Font Awesome Pro 7.2.0 solid metadata. Do not edit directly. */',
    '@font-face {',
    `  font-family: '${FONT_FAMILY}';`,
    '  font-style: normal;',
    '  font-weight: 900;',
    '  font-display: block;',
    "  src: url('./webfonts/fa-solid-900.woff2') format('woff2');",
    '}',
    '',
    'ss-helper-icon {',
    "  --ss-helper-icon-glyph: '?';",
    '  --ss-helper-icon-family: system-ui, sans-serif;',
    '  display: inline-block;',
    '  flex: 0 0 auto;',
    '  width: var(--ss-helper-icon-width, 1.25em);',
    '  color: inherit;',
    '  font-family: var(--ss-helper-icon-family);',
    '  font-size: inherit;',
    '  font-style: normal;',
    '  font-synthesis: none;',
    '  font-weight: 900;',
    '  line-height: 1;',
    '  text-align: center;',
    '  text-rendering: auto;',
    '  -webkit-font-smoothing: antialiased;',
    '  -moz-osx-font-smoothing: grayscale;',
    '}',
    'ss-helper-icon::before { content: var(--ss-helper-icon-glyph); }',
    'ss-helper-icon:not([fixed-width]) { width: auto; min-width: 1em; }',
    'ss-helper-icon[hidden] { display: none !important; }',
    'ss-helper-icon[data-ss-helper-icon-invalid="true"] { --ss-helper-icon-glyph: "?"; --ss-helper-icon-family: system-ui, sans-serif; }',
    '',
    ...mappings,
    '',
  ].join('\n');
}

export function generateIconCss() {
  return renderIsolatedIconCss(extractSolidIcons(readFileSync(sourcePath, 'utf8')));
}

const generated = generateIconCss();
if (process.argv.includes('--check')) {
  if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8').replace(/\r\n?/gu, '\n') !== generated) {
    throw new Error('public/fontawesome/ss-helper-icons.css is stale; run pnpm generate:icons');
  }
} else {
  writeFileSync(outputPath, generated, 'utf8');
  process.stdout.write(`${outputPath}\n`);
}
