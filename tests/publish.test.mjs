import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile, symlink, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {REPOSITORY, MANIFEST, safeRelativePath, validateManifest, verifySource, copySource, assertImportBase} from '../scripts/publish-github.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const sha = content => createHash('sha256').update(content).digest('hex');
const baseCommit = '02416cc35e685597f1f9aaf3973df01ef0b7c914';
const paths = ['package.json', 'public/studio.html', 'scripts/publish-github.mjs', '.github/workflows/pages.yml'];
function manifest() {
  return {version: 1, repository: REPOSITORY, baseCommit, files: paths.map(name => ({path: name, sha256: sha(name), mode: 0o644}))};
}
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'veyra-publisher-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const source = path.join(directory, 'source'), target = path.join(directory, 'target');
  await mkdir(source); await mkdir(target);
  const data = manifest();
  for (const file of data.files) {
    await mkdir(path.dirname(path.join(source, file.path)), {recursive: true});
    await writeFile(path.join(source, file.path), file.path);
  }
  return {source, target, data, directory};
}

test('Publisher accepts normal nested and hidden source paths', () => {
  for (const name of ['README.md', '.gitignore', '.openai/hosting.json', 'app/api/[[...path]]/route.ts', 'public/app/app.js']) {
    assert.equal(safeRelativePath(name), name);
  }
});
test('Publisher rejects traversal, Git metadata, secrets, absolute and ambiguous paths', () => {
  for (const name of ['', '../escape', '/etc/passwd', 'C:/secrets', 'foo\\bar', 'a/../b', 'a/./b', 'a//b', 'a/',
    '.git/config', 'nested/.git/config', '.env', 'a/.env.local', 'a\0b', null, 23]) {
    assert.throws(() => safeRelativePath(name), /Unsafe source path/);
  }
});
test('Publisher validates the target repository and remote baseline', () => {
  assert.equal(validateManifest(manifest()).repository, REPOSITORY);
  for (const override of [{version: 2}, {repository: 'other/repo'}, {baseCommit: ''}, {files: []}, {files: null}]) {
    assert.throws(() => validateManifest({...manifest(), ...override}), /Invalid source manifest/);
  }
});
test('Publisher rejects duplicate, corrupt and executable-mode manifest entries', () => {
  const original = manifest();
  assert.throws(() => validateManifest({...original, files: [...original.files, original.files[0]]}), /Invalid manifest entry/);
  for (const override of [{sha256: 'bad'}, {mode: 0o777}, {path: MANIFEST}]) {
    const data = manifest(); data.files[0] = {...data.files[0], ...override};
    assert.throws(() => validateManifest(data), /Invalid manifest entry/);
  }
});
test('Publisher refuses incomplete source manifests', () => {
  const data = manifest(); data.files.pop();
  assert.throws(() => validateManifest(data), /Missing source file/);
});
test('Publisher verifies the complete source against SHA-256 checksums', async t => {
  const {source, data} = await fixture(t);
  assert.equal(await verifySource(source, data), 4);
  await writeFile(path.join(source, 'public/studio.html'), 'corrupted');
  await assert.rejects(verifySource(source, data), /checksum mismatch/);
});
test('Publisher rejects symlink source files', async t => {
  const {source, data} = await fixture(t);
  await rm(path.join(source, 'public/studio.html'));
  await symlink(path.join(source, 'package.json'), path.join(source, 'public/studio.html'));
  await assert.rejects(verifySource(source, data), /Not a regular source path/);
});
test('Publisher rejects symlink source directories', async t => {
  const {source, data, directory} = await fixture(t);
  const external = path.join(directory, 'external'); await mkdir(external);
  await writeFile(path.join(external, 'studio.html'), 'public/studio.html');
  await rm(path.join(source, 'public'), {recursive: true});
  await symlink(external, path.join(source, 'public'), 'dir');
  await assert.rejects(verifySource(source, data), /Not a regular source path/);
});
test('Publisher preserves unrelated files and removes only obsolete import scaffolding', async t => {
  const {source, target, data} = await fixture(t);
  await writeFile(path.join(target, 'keep.txt'), 'unrelated remote work');
  await mkdir(path.join(target, '.source-import'));
  await writeFile(path.join(target, '.source-import/part-000'), 'old incomplete archive');
  await mkdir(path.join(target, '.github/workflows'), {recursive: true});
  await writeFile(path.join(target, '.github/workflows/import-archive.yml'), 'old workflow');
  await copySource(source, target, data);
  assert.equal(await verifySource(target, data), 4);
  assert.deepEqual(JSON.parse(await readFile(path.join(target, MANIFEST), 'utf8')), data);
  assert.equal(await readFile(path.join(target, 'keep.txt'), 'utf8'), 'unrelated remote work');
  await assert.rejects(stat(path.join(target, '.source-import')), {code: 'ENOENT'});
  await assert.rejects(stat(path.join(target, '.github/workflows/import-archive.yml')), {code: 'ENOENT'});
});
test('Publisher refuses to copy corrupt input before touching the destination', async t => {
  const {source, target, data} = await fixture(t);
  await writeFile(path.join(source, 'package.json'), 'bad checksum');
  await writeFile(path.join(target, 'package.json'), 'original');
  await assert.rejects(copySource(source, target, data), /checksum mismatch/);
  assert.equal(await readFile(path.join(target, 'package.json'), 'utf8'), 'original');
});
test('Publisher refuses identical source and target directories', async t => {
  const {source, data} = await fixture(t);
  await assert.rejects(copySource(source, source, data), /must differ/);
});
test('Publisher rejects symlink targets instead of writing outside the checkout', async t => {
  const {source, target, data, directory} = await fixture(t);
  const external = path.join(directory, 'external'); await mkdir(external);
  await symlink(external, path.join(target, 'public'), 'dir');
  await assert.rejects(copySource(source, target, data), /Symlink in target/);
  await assert.rejects(stat(path.join(external, 'studio.html')), {code: 'ENOENT'});
});
test('Publisher stops when the remote baseline changed, unless the exact source is already imported', () => {
  assert.doesNotThrow(() => assertImportBase(baseCommit, manifest(), false));
  assert.throws(() => assertImportBase('a'.repeat(40), manifest(), false), /Remote main has advanced/);
  assert.doesNotThrow(() => assertImportBase('a'.repeat(40), manifest(), true));
});
test('Pages publishes artifacts without requiring a gh-pages branch or repository write permission', async () => {
  const workflow = await readFile(path.join(root, '.github/workflows/pages.yml'), 'utf8');
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /contents: write|git push|git fetch origin gh-pages/);
  assert.match(workflow, /needs: build/);
  assert.match(workflow, /pages: write/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /actions\/upload-pages-artifact@v4/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
});
test('Both CI and Pages install the managed browser and retain the browser-test gate', async () => {
  for (const name of ['ci.yml', 'pages.yml']) {
    const workflow = await readFile(path.join(root, '.github/workflows', name), 'utf8');
    assert.match(workflow, /playwright install --with-deps chromium/);
    assert.match(workflow, /tests\/browser-pages\.py --managed-browser/);
    assert.doesNotMatch(workflow, /continue-on-error/);
  }
});
