import { writeFileSync } from 'node:fs';
import { URL } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { tokens, themes } from '../src/tokens.ts';
const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const css = {};
const add = (prefix, values) =>
  Object.entries(values).forEach(([key, value]) => {
    css[`--${prefix}-${kebab(key)}`] = value;
  });
add('color-platform', tokens.palettes.firmivra);
add('color-lvp', tokens.palettes.lvp);
add('color', tokens.neutral);
css['--color-surface'] = tokens.neutral.white;
add('color-folder', tokens.folder);
add('color', tokens.status);
add('color-business', tokens.business);
add('color', themes.firmivra);
Object.assign(css, {
  '--color-brand-50': tokens.folder.surface,
  '--color-brand-100': tokens.folder.hover,
  '--color-brand-500': tokens.palettes.firmivra.blue,
  '--color-brand-600': tokens.palettes.firmivra.blueHover,
  '--color-brand-700': 'var(--color-action)',
  '--color-brand-900': 'var(--color-heading)',
  '--color-accent-500': 'var(--color-accent)',
  '--color-accent-600': tokens.palettes.firmivra.teal,
  '--color-firm-primary': 'var(--color-action)',
  '--color-firm-accent': 'var(--color-accent)',
  '--color-overlay': tokens.overlay,
  '--color-transparent': 'transparent',
  '--font-sans': tokens.typography.sans,
  '--font-display': tokens.typography.display,
  '--tracking-eyebrow': tokens.typography.eyebrowTracking,
  '--spacing': tokens.spacing['1'],
});
add('text', tokens.typography.size);
Object.entries(tokens.typography.lineHeight).forEach(([key, value]) => {
  css[`--text-${key}--line-height`] = value;
});
add('font-weight', tokens.typography.weight);
add('space', tokens.spacing);
add('radius', tokens.radius);
css['--radius-control'] = tokens.radius.md;
css['--radius-card'] = tokens.radius.lg;
add('shadow', tokens.shadow);
css['--shadow-card'] = tokens.shadow.sm;
add('breakpoint', tokens.breakpoint);
add('container', tokens.layout);
css['--spacing-sidebar'] = tokens.layout.sidebar;
css['--spacing-public'] = tokens.layout.public;
const block = (values) =>
  Object.entries(values)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n');
const scoped = Object.entries(themes)
  .filter(([name]) => name !== 'firmivra')
  .map(
    ([name, values]) =>
      `[data-theme="${name}"] {\n${block(Object.fromEntries(Object.entries(values).map(([key, value]) => [`--color-${kebab(key)}`, value])))}\n}`,
  )
  .join('\n');
const target = new URL('../src/tokens.css', import.meta.url);
const config = await resolveConfig(target);
writeFileSync(
  target,
  await format(
    `/* Generated from tokens.ts. Do not edit by hand. */\n@theme {\n  --color-*: initial;\n${block(css)}\n}\n${scoped}\n`,
    { ...config, parser: 'css' },
  ),
);
