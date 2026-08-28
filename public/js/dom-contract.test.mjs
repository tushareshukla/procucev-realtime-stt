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

  // Regression: an edit sliced out showRecording() while leaving its call site
  // intact. The module threw at runtime and the whole UI went dead. Nothing in
  // the suite noticed, because a missing function is not a syntax error.
  test('every function app.js calls is defined or imported', () => {
    // Comments and string literals mention names that are never called; strip
    // them so prose does not register as code.
    const code = app
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, '``');

    const declared = new Set([
      ...[...code.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
      ...[...code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]),
      ...[...app.matchAll(/import\s*\{([^}]+)\}/g)]
        .flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop())),
      // Parameters are in scope wherever they are used.
      ...[...code.matchAll(/\(([^()]*)\)\s*=>/g)]
        .flatMap((m) => m[1].split(',').map((x) => x.trim().replace(/[={].*$/, '').trim()))
        .filter(Boolean),
      ...[...code.matchAll(/function[^(]*\(([^()]*)\)/g)]
        .flatMap((m) => m[1].split(',').map((x) => x.trim().replace(/[={].*$/, '').trim()))
        .filter(Boolean),
    ]);

    const BUILTINS = new Set([
      'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'await', 'function',
      'Promise', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Math', 'JSON', 'Date',
      'Error', 'Set', 'Map', 'Blob', 'File', 'FileReader', 'Audio', 'AudioContext',
      'WebSocket', 'URL', 'fetch', 'setTimeout', 'setInterval', 'clearTimeout',
      'requestAnimationFrame', 'cancelAnimationFrame', 'addEventListener', 'parseInt',
      'parseFloat', 'isNaN', 'console', 'document', 'window', 'navigator', 'localStorage',
      'Int16Array', 'Float32Array', 'Uint8Array', 'DataView', 'ArrayBuffer', 'MouseEvent',
      'Event', 'CustomEvent', 'TextDecoder', 'TextEncoder', 'structuredClone', 'queueMicrotask',
      'getComputedStyle', 'async', 'else', 'try', 'do', 'new', 'delete', 'void', 'yield',
    ]);

    const called = new Set(
      [...code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]),
    );

    const missing = [...called].filter((n) => !declared.has(n) && !BUILTINS.has(n));
    assert.deepEqual(missing, [], `app.js calls undefined functions: ${missing.join(', ')}`);
  });

  test('asset URLs carry a cache-busting placeholder', () => {
    assert.match(html, /app\.js\?v=__BUILD__/);
    for (const m of app.matchAll(/from '\.\/js\/([^']+)'/g)) {
      assert.match(m[1], /\?v=__BUILD__$/, `import of ${m[1]} is missing the version stamp`);
    }
  });
});
