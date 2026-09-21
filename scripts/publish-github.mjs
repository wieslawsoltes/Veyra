#!/usr/bin/env node
/** Publish the recovered source without force-pushing or discarding newer remote work.
 * Requires an authenticated GitHub CLI, Git, Node.js >=22.13 and npm.
 * Run from the extracted source: node scripts/publish-github.mjs
 * No tokens are accepted by this script, written to files, or printed.
 */
import {createHash} from 'node:crypto';
import {copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile, chmod} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const REPOSITORY = 'wieslawsoltes/Veyra';
export const MANIFEST = 'release/source-manifest.json';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function safeRelativePath(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes('\0') ||
      path.posix.isAbsolute(name) || /^[A-Za-z]:/.test(name) ||
      name.split('/').some(part => !part || part === '.' || part === '..' || part === '.git') ||
      /(^|\/)\.env(?:\.|$)/.test(name)) throw new Error(`Unsafe source path: ${name}`);
  return name;
}
export function validateManifest(manifest) {
  if (manifest?.version !== 1 || manifest.repository !== REPOSITORY ||
      !/^[a-f0-9]{40}$/.test(manifest.baseCommit || '') ||
      !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Invalid source manifest.');
  const names = new Set();
  for (const file of manifest.files) {
    safeRelativePath(file.path);
    if (file.path === MANIFEST || names.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256 || '') ||
        ![0o644, 0o755].includes(file.mode)) throw new Error(`Invalid manifest entry: ${file.path}`);
    names.add(file.path);
  }
  for (const required of ['package.json', 'public/studio.html', 'scripts/publish-github.mjs', '.github/workflows/pages.yml']) {
    if (!names.has(required)) throw new Error(`Missing source file: ${required}`);
  }
  return manifest;
}
async function regularFile(root, relative) {
  const components = safeRelativePath(relative).split('/');
  let current = root;
  for (let index = 0; index < components.length; index++) {
    current = path.join(current, components[index]);
    const info = await lstat(current);
    if (info.isSymbolicLink() || (index < components.length - 1 ? !info.isDirectory() : !info.isFile())) {
      throw new Error(`Not a regular source path: ${relative}`);
    }
  }
  return current;
}
export async function verifySource(root, manifest) {
  validateManifest(manifest);
  for (const file of manifest.files) {
    const content = await readFile(await regularFile(root, file.path));
    if (digest(content) !== file.sha256) throw new Error(`Source checksum mismatch: ${file.path}`);
  }
  return manifest.files.length;
}
export function assertImportBase(head, manifest, sameSource) {
  if (head !== manifest.baseCommit && !sameSource) {
    throw new Error(`Remote main has advanced (${head}). No source was overwritten. Review and merge the newer work before publishing.`);
  }
}
export async function copySource(source, destination, manifest) {
  if (path.resolve(source) === path.resolve(destination)) throw new Error('Source and destination must differ.');
  await verifySource(source, manifest);
  for (const file of manifest.files) {
    const target = path.join(destination, file.path);
    // Never follow a pre-existing symlink in the destination, either.
    let current = destination;
    for (const component of file.path.split('/')) {
      current = path.join(current, component);
      const info = await lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (info?.isSymbolicLink()) throw new Error(`Symlink in target: ${file.path}`);
    }
    await mkdir(path.dirname(target), {recursive: true});
    await copyFile(path.join(source, file.path), target);
    await chmod(target, file.mode);
  }
  await mkdir(path.join(destination, 'release'), {recursive: true});
  const destinationManifest = path.join(destination, MANIFEST);
  const info = await lstat(destinationManifest).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (info?.isSymbolicLink()) throw new Error('Symlink in target manifest.');
  await writeFile(destinationManifest, JSON.stringify(manifest, null, 2) + '\n');
  // Retire only the earlier interrupted import, not arbitrary repository files.
  await rm(path.join(destination, '.source-import'), {recursive: true, force: true});
  await rm(path.join(destination, '.github/workflows/import-archive.yml'), {force: true});
}
function execute(command, args, {cwd = ROOT, capture = false, allowFailure = false} = {}) {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 16 * 1024 * 1024,
    timeout: 30 * 60 * 1000, env: {...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1'},
  });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) throw new Error(`${command} failed (exit ${result.status}).${capture ? '\n' + (result.stderr || '') : ''}`);
  return capture ? result : result.status;
}
function api(endpoint, args = [], allowFailure = false) {
  return execute('gh', ['api', '--hostname', 'github.com', endpoint, ...args], {capture: true, allowFailure});
}
function jsonApi(endpoint) { return JSON.parse(api(endpoint).stdout); }
// Credential helper applies only to this Git invocation; no global settings change.
function git(args, cwd, capture = false) {
  return execute('git', ['-c', 'credential.helper=', '-c', 'credential.https://github.com.helper=!gh auth git-credential', ...args], {cwd, capture});
}
function localChecks(cwd) {
  // npm is a .cmd shim on Windows; calling its JS entry point avoids a shell.
  if (process.platform === 'win32') throw new Error('Run this publisher in WSL, macOS, or Linux. The app itself remains cross-platform.');
  execute('npm', ['test'], {cwd});
  execute(process.execPath, ['standalone/server.mjs', '--check'], {cwd});
  execute(process.execPath, ['scripts/build-pages.mjs', '/Veyra/'], {cwd});
}
async function main() {
  const manifest = validateManifest(JSON.parse(await readFile(path.join(ROOT, MANIFEST), 'utf8')));
  console.log(`Verified ${await verifySource(ROOT, manifest)} source files.`);
  if (process.argv.includes('--check')) { localChecks(ROOT); return; }
  execute('gh', ['auth', 'status', '--active', '--hostname', 'github.com']);
  const repository = jsonApi(`repos/${REPOSITORY}`);
  if (repository.full_name?.toLowerCase() !== REPOSITORY.toLowerCase() || !repository.permissions?.push) {
    throw new Error(`The active GitHub account cannot push to ${REPOSITORY}.`);
  }
  if (repository.default_branch !== 'main') throw new Error('Unexpected default branch. No changes were made.');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'veyra-publish-'));
  const workingCopy = path.join(directory, 'repository');
  console.log(`Working copy (retained on success or failure): ${workingCopy}`);
  git(['clone', '--single-branch', '--branch', 'main', `https://github.com/${REPOSITORY}.git`, workingCopy], directory);
  let head = git(['rev-parse', 'HEAD'], workingCopy, true).stdout.trim();
  const localManifest = JSON.stringify(manifest);
  const remoteManifest = await readFile(path.join(workingCopy, MANIFEST), 'utf8').catch(() => null);
  let sameSource = false;
  if (remoteManifest && JSON.stringify(JSON.parse(remoteManifest)) === localManifest) {
    await verifySource(workingCopy, manifest);
    sameSource = true;
  }
  assertImportBase(head, manifest, sameSource);
  if (!sameSource) await copySource(ROOT, workingCopy, manifest);
  localChecks(workingCopy);
  git(['add', '-A'], workingCopy);
  const changes = git(['diff', '--cached', '--name-only'], workingCopy, true).stdout.trim();
  if (changes) {
    git(['-c', 'user.name=Veyra source import', '-c', 'user.email=veyra-import@users.noreply.github.com',
      'commit', '-m', 'feat: import complete Veyra Studio with verified GitHub Pages deployment'], workingCopy);
    head = git(['rev-parse', 'HEAD'], workingCopy, true).stdout.trim();
  }
  const pages = api(`repos/${REPOSITORY}/pages`, [], true);
  if (pages.status === 0) {
    if (JSON.parse(pages.stdout).build_type !== 'workflow') api(`repos/${REPOSITORY}/pages`, ['--method', 'PUT', '-f', 'build_type=workflow']);
  } else if (/HTTP 404/.test(pages.stderr || '')) {
    api(`repos/${REPOSITORY}/pages`, ['--method', 'POST', '-f', 'build_type=workflow']);
  } else throw new Error(`Cannot inspect Pages settings: ${pages.stderr}`);

  const runsEndpoint = `repos/${REPOSITORY}/actions/runs?head_sha=${head}&per_page=100`;
  const previousIds = new Set(jsonApi(runsEndpoint).workflow_runs.map(run => run.id));
  if (changes) git(['push', 'origin', 'HEAD:main'], workingCopy);
  else execute('gh', ['workflow', 'run', 'pages.yml', '--repo', REPOSITORY, '--ref', 'main']);
  let deployment;
  for (let attempt = 0; attempt < 60; attempt++) {
    deployment = jsonApi(runsEndpoint).workflow_runs.find(run =>
      run.path === '.github/workflows/pages.yml' && !previousIds.has(run.id));
    if (deployment) break;
    await pause(3000);
  }
  if (!deployment) throw new Error(`Source commit ${head} is on GitHub, but no new Pages workflow appeared. Check repository Actions settings.`);
  execute('gh', ['run', 'watch', String(deployment.id), '--repo', REPOSITORY, '--exit-status', '--interval', '3']);
  const publishedPages = jsonApi(`repos/${REPOSITORY}/pages`);
  const site = new URL(publishedPages.html_url);
  if (site.protocol !== 'https:') throw new Error('Refusing to verify a non-HTTPS Pages URL.');
  let verified = false;
  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      const url = new URL('deployment.json', site.href.endsWith('/') ? site.href : site.href + '/');
      url.searchParams.set('revision', head);
      const response = await fetch(url, {signal: AbortSignal.timeout(15000), cache: 'no-store'});
      const data = response.ok ? await response.json() : null;
      if (data?.commit === head && data?.base === '/Veyra/' && data?.mode === 'browser-local') { verified = true; break; }
    } catch { /* A successful workflow can precede edge-cache availability. */ }
    await pause(5000);
  }
  if (!verified) throw new Error(`Pages workflow passed, but the live deployment revision did not match ${head}. Publication is not verified.`);
  const result = {repository: REPOSITORY, commit: head, workflow: deployment.html_url, site: site.href, verified: true};
  await writeFile(path.join(directory, 'publication-result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Publication stopped: ${error.message}`); process.exitCode = 1; });
}
