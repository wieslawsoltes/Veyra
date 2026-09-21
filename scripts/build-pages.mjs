#!/usr/bin/env node
/** Dependency-free static deployment. Only public files are published, never the server or database. */
import {cp, readFile, writeFile, readdir, rm, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export function normalizeBase(value = '/') {
  if (typeof value !== 'string' || !/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(value)) {
    throw new Error('Base must be an absolute directory path with a trailing slash, for example /Veyra/.');
  }
  return value;
}
async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not supported in static output.');
    if (entry.isDirectory()) output.push(...await walk(file));
    else output.push(file);
  }
  return output;
}
export async function buildPages({base = '/', outDir = path.join(root, 'dist-pages')} = {}) {
  normalizeBase(base);
  const output = path.resolve(outDir);
  const relative = path.relative(root, output);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !relative.startsWith('dist-pages')) {
    throw new Error('Output must be a dist-pages directory inside the repository.');
  }
  await rm(output, {recursive: true, force: true});
  await mkdir(output, {recursive: true});
  await cp(path.join(root, 'public'), output, {recursive: true});
  for (const file of await walk(output)) {
    if (!/\.(?:html|js|css)$/.test(file)) continue;
    let text = await readFile(file, 'utf8');
    // Rewrite first-party absolute URLs only; preserve external/protocol-relative URLs.
    text = text.replace(/(["'`])\/(?!\/)(?=(?:app|packages|assets|examples)\/|(?:favicon|file|globe|window)\.svg)/g, `$1${base}`);
    text = text.replace(/href="\/"/g, `href="${base}"`);
    if (file.endsWith(path.sep + 'studio.html')) {
      text = text.replace('<head>', '<head><meta name="veyra-storage" content="browser">');
    }
    await writeFile(file, text);
  }
  await cp(path.join(output, 'studio.html'), path.join(output, 'index.html'));
  await writeFile(path.join(output, '.nojekyll'), '');
  await writeFile(path.join(output, 'deployment.json'), JSON.stringify({name: 'Veyra Studio', mode: 'browser-local', base,
    commit: process.env.GITHUB_SHA || null, collaboration: 'Requires the separately deployed server API.'}, null, 2) + '\n');
  return output;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2] || process.env.PAGES_BASE_PATH || '/Veyra/';
  const output = await buildPages({base});
  console.log(`Static Veyra app: ${output} (base ${base}; IndexedDB storage; no backend dependencies).`);
}
