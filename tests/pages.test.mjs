import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, stat, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPages, normalizeBase} from '../scripts/build-pages.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));

test('Pages accepts root and nested deployment prefixes', () => {
  assert.equal(normalizeBase('/'), '/');
  assert.equal(normalizeBase('/Veyra/'), '/Veyra/');
  assert.equal(normalizeBase('/nested/Veyra/'), '/nested/Veyra/');
});
test('Pages rejects unsafe and ambiguous deployment prefixes', () => {
  for (const base of ['Veyra', '/Veyra', '//', '/../', '/a//b/', '/a?b/', '/a\\b/', '/%2e%2e/', 'https://example.com/']) {
    assert.throws(() => normalizeBase(base));
  }
});
test('Pages refuses to replace the source tree', async () => {
  await assert.rejects(buildPages({outDir: root}));
  await assert.rejects(buildPages({outDir: path.join(root, 'public')}));
  await assert.rejects(buildPages({outDir: path.join(root, '..', 'external')}));
});
test('Pages build is self-contained at a nested project path', async t => {
  const base = '/nested/Veyra/';
  const output = await buildPages({base, outDir: path.join(root, 'dist-pages-test')});
  t.after(() => rm(output, {recursive: true, force: true}));
  const html = await readFile(path.join(output, 'index.html'), 'utf8');
  assert.match(html, /name="veyra-storage" content="browser"/);
  assert.equal(html, await readFile(path.join(output, 'studio.html'), 'utf8'));
  for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    assert.ok(url.startsWith(base), `Unscoped asset URL: ${url}`);
    assert.ok(await stat(path.join(output, url.slice(base.length))));
  }
  const app = await readFile(path.join(output, 'app/app.js'), 'utf8');
  const core = await readFile(path.join(output, 'packages/core/index.js'), 'utf8');
  assert.ok(!/['"]\/(?:app|packages|assets)\//.test(app + core));
  assert.ok(core.includes(`${base}assets/neon-city.jpg`));
  assert.match(app, /browserStore\.call\(path,options\)/);
  assert.ok(await stat(path.join(output, 'app/browser-storage.js')));
  assert.ok(await stat(path.join(output, '.nojekyll')));
  const deployment = JSON.parse(await readFile(path.join(output, 'deployment.json'), 'utf8'));
  assert.equal(deployment.base, base);
  assert.equal(deployment.mode, 'browser-local');
  for (const privatePath of ['server', 'standalone', 'drizzle', '.openai', '.veyra-data', '.github']) {
    await assert.rejects(stat(path.join(output, privatePath)));
  }
});
