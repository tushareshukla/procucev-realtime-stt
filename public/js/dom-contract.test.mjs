import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
const app = readFileSync(join(PUBLIC, 'app.js'), 'utf8');

const idsInHtml = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const idsUsed = [...app.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);

describe('DOM contract between app.js and index.html', () => {
  // Regression: app.js kept a handler on an element that had been deleted from
  // the markup. $() returned null, assigning to it threw at module top level,
  // and that one line killed everything after it — tabs, the name prompt, and
  // history loading all silently stopped working.
  test('every element app.js reaches for exists in the markup', () => {
    const missing = [...new Set(idsUsed)].filter((id) => !idsInHtml.has(id));
    assert.deepEqual(missing, [], `app.js references ids that do not exist: ${missing.join(', ')}`);
  });

  test('app.js is actually referenced by the page', () => {
    assert.match(html, /<script[^>]+src="\/app\.js/);
  });

  test('the page loads app.js as a module, since it uses imports', () => {
    assert.match(app, /^import /m);
    assert.match(html, /<script type="module"/);
  });

  test('asset URLs carry a cache-busting placeholder', () => {
    assert.match(html, /app\.js\?v=__BUILD__/);
    for (const m of app.matchAll(/from '\.\/js\/([^']+)'/g)) {
      assert.match(m[1], /\?v=__BUILD__$/, `import of ${m[1]} is missing the version stamp`);
    }
  });
});
