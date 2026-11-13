const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { extensionTheme, publicTheme, THEME_TOKENS } = require('../src/extension-theme.cjs');

test('extension colors match the actual app palette and readable accent for arbitrary selected colors', () => {
  const source = fs.readFileSync(require.resolve('../src/shared/theme.js'), 'utf8');
  for (const surfaceColor of ['#e8edf3', '#202632', '#f700d0', '#777777', '#000000', '#ffffff']) {
    for (const color of ['#ff3045', '#ffffff', '#000000', '#22c55e', '#438bff']) {
      const values = {}, element = { style: { setProperty: (key, value) => { values[key] = value; } }, dataset: {} };
      const context = { document: { documentElement: element } };
      vm.runInNewContext(source, context);
      context.LibertyTheme.apply(color, surfaceColor);
      const theme = extensionTheme(color, surfaceColor);
      assert.equal(theme.appearance, element.dataset.appearance);
      assert.deepEqual(Object.keys(theme.tokens), [...THEME_TOKENS]);
      for (const name of THEME_TOKENS) assert.equal(theme.tokens[name], values[name], `${surfaceColor}/${color}: ${name}`);
    }
  }
});
test('extension theme serialization excludes settings and rejects partial or resource-bearing values', () => {
  const theme = extensionTheme('#ffffff', '#f700d0');
  const supplied = { ...theme, token: 'private', preferences: { nickname: 'private' }, tokens: { ...theme.tokens, '--secret': 'private' } };
  assert.deepEqual(publicTheme(supplied), theme);
  assert.equal(JSON.stringify(publicTheme(supplied)).includes('private'), false);
  for (const invalid of [null, {}, { ...theme, appearance: 'auto' }, { ...theme, tokens: {} }, { ...theme, tokens: { ...theme.tokens, '--app-bg': 'url(https://example.com/private)' } }]) assert.equal(publicTheme(invalid), null);
});
