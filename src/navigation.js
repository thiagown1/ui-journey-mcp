import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { extractWeb, extractFlutter } from './discovery.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const safe = z.string().min(1).max(240).refine(s => !path.posix.isAbsolute(s) && !/[\\\0\r\n:]/.test(s) && !s.split('/').some(p => !p || p === '..' || p === '.'));
const configSchema = z.object({ schema: z.literal('ui-journey-project/v1'), project: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), webRoots: z.array(safe).max(20).default([]), flutterRoots: z.array(z.object({ root: safe, package: z.string().regex(/^[a-z][a-z0-9_]*$/), rootModule: z.string().regex(/^\w+$/).default('AppModule') }).strict()).max(20).default([]) }).strict();
const ignored = /(?:^|\/)(?:node_modules|\.git|\.next|build|dist|test-results|coverage|__tests__|e2e|test|tests|scripts)\/|\.(?:test|spec|d)\.[jt]sx?$|\.(?:g|freezed)\.dart$/;
const code = f => /\.[cm]?[jt]sx?$|\.dart$/.test(f);
const within = (file, root) => file.startsWith(root + '/');
function git(repo, args, options = {}) { return execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd: repo, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, windowsHide: true, ...options }); }
async function regularRead(repo, file) {
  safe.parse(file);
  let current = repo;
  for (const part of file.split('/')) { current = path.join(current, part); const stat = await fs.lstat(current); if (stat.isSymbolicLink()) throw new Error('Symlinks are not indexed'); }
  const stat = await fs.stat(current);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('Source must be a regular file under 2 MiB');
  return fs.readFile(current);
}
async function readTree(repo, revision, configFile) {
  const head = git(repo, ['rev-parse', 'HEAD']).trim();
  if (revision && !/^[a-f0-9]{40}$/.test(revision)) throw new Error('Expected full commit SHA');
  let configText;
  let configSource = revision ? 'revision' : 'worktree';
  if (revision) {
    try { configText = git(repo, ['show', `${revision}:${configFile}`], { stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { configText = (await regularRead(repo, configFile)).toString('utf8'); configSource = 'worktree-fallback'; }
  }
  else configText = (await regularRead(repo, configFile)).toString('utf8');
  const config = configSchema.parse(JSON.parse(configText));
  const roots = [...config.webRoots, ...config.flutterRoots.map(r => r.root)];
  if (!roots.length) throw new Error('Configure at least one source root');
  const all = [...new Set(git(repo, revision ? ['ls-tree', '-rz', '--name-only', revision, '--', ...roots] : ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...roots]).split('\0').filter(Boolean))].sort();
  const files = all.filter(f => !ignored.test(f) && (code(f) || /\.(?:json|css|scss|yaml|yml)$/.test(f)) && roots.some(r => within(f, r)));
  if (files.length > 20000) throw new Error('Source file limit exceeded');
  const sources = {}; let total = 0;
  if (revision) {
    files.forEach(f => safe.parse(f));
    const batch = git(repo, ['cat-file', '--batch'], { input: files.map(f => `${revision}:${f}\n`).join(''), encoding: null });
    let offset = 0;
    for (const f of files) {
      const end = batch.indexOf(10, offset), header = batch.subarray(offset, end).toString('utf8');
      const match = /^[a-f0-9]{40} blob (\d+)$/.exec(header);
      if (!match || Number(match[1]) > 2 * 1024 * 1024) throw new Error('Invalid or oversized source blob');
      const size = Number(match[1]); sources[f] = batch.subarray(end + 1, end + 1 + size); total += size; offset = end + size + 2;
    }
  } else for (let start = 0; start < files.length; start += 32) {
    const batch = await Promise.all(files.slice(start, start + 32).map(async f => {
      try { return [f, await regularRead(repo, f)]; } catch (e) { if (e.code !== 'ENOENT') throw e; return [f, null]; }
    }));
    for (const [f, bytes] of batch) if (bytes) { total += bytes.length; sources[f] = bytes; }
  }
  if (total > 64 * 1024 * 1024) throw new Error('Source byte limit exceeded');
  const hashes = Object.fromEntries(Object.entries(sources).map(([f, b]) => [f, hash(b)]));
  hashes[configFile] = hash(JSON.stringify(config));
  const contentHash = hash(JSON.stringify([config, hashes]));
  const dirty = !revision && git(repo, ['status', '--porcelain', '--untracked-files=normal', '--', configFile, ...roots]).trim().length > 0;
  return { config, configSource, sources, hashes, contentHash, revision: revision ?? head, dirty, head };
}
function resolveImport(file, specifier, config, files) {
  let base;
  if (specifier.startsWith('.') || (file.endsWith('.dart') && !specifier.includes(':'))) base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  else if (specifier.startsWith('@/')) { const root = config.webRoots.find(r => within(file, r)); if (root) base = `${root}/${specifier.slice(2)}`; }
  else if (specifier.startsWith('package:')) {
    const root = config.flutterRoots.find(r => within(file, r.root) && specifier.startsWith(`package:${r.package}/`));
    if (root) base = `${root.root}/lib/${specifier.slice(`package:${root.package}/`.length)}`;
  }
  if (!base) return { external: true };
  return { target: [base, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '/index.ts', '/index.tsx', '/index.js'].map(e => base + e)].find(f => files.has(f)) ?? null };
}
function closure(roots, imports) { const seen = new Set(roots), queue = [...seen]; for (let i = 0; i < queue.length; i++) for (const f of imports[queue[i]] ?? []) if (!seen.has(f)) { seen.add(f); queue.push(f); } return [...seen].sort(); }
const routeId = (platform, file, route) => `${platform}-${hash(`${file}:${route}`).slice(0, 20)}`;
function assemble(tree, parsed) {
  const files = new Set(Object.keys(tree.sources)), imports = {}, actions = [], diagnostics = [], routes = [];
  for (const [file, item] of Object.entries(parsed)) {
    imports[file] = [];
    for (const spec of item.imports) { const r = resolveImport(file, spec, tree.config, files); if (r.target) imports[file].push(r.target); else if (!r.external) diagnostics.push({ file, kind: 'unresolved-import', specifier: spec }); }
    item.actions.forEach((a, i) => actions.push({ ...a, file, id: hash(`${file}:${a.line}:${i}`).slice(0, 24), evidence: 'inferred' }));
    diagnostics.push(...item.diagnostics.map(d => ({ file, ...d })));
  }
  for (const root of tree.config.webRoots) {
    const layouts = [...files].filter(f => (within(f, `${root}/app`) || within(f, `${root}/src/app`)) && /\/layout\.[jt]sx?$/.test(f));
    for (const file of files) {
      const prefix = file.startsWith(`${root}/app/`) ? `${root}/app/` : file.startsWith(`${root}/src/app/`) ? `${root}/src/app/` : null;
      if (!prefix || !/\/page\.[jt]sx?$/.test(file)) continue;
      const route = '/' + file.slice(prefix.length).replace(/(?:\/)?page\.[jt]sx?$/, '').split('/').filter(p => p && !/^\(.*\)$/.test(p) && !p.startsWith('@')).join('/');
      routes.push({ id: routeId('web', file, route), platform: 'web', route, file, evidence: 'inferred', dependencies: closure([file, ...layouts.filter(l => file.startsWith(path.posix.dirname(l) + '/'))], imports) });
    }
  }
  for (const adapter of tree.config.flutterRoots) {
    const classes = Object.entries(parsed).filter(([f]) => within(f, adapter.root)).flatMap(([file, p]) => p.classes.map(c => ({ file, ...c })));
    const findClass = name => { const found = classes.filter(c => c.name === name); return found.length === 1 ? found[0] : null; };
    const mounted = new Set();
    function mount(name, prefix, chain = []) {
      const module = findClass(name);
      if (!module || chain.includes(name) || chain.length > 30) { diagnostics.push({ file: module?.file ?? adapter.root, kind: 'unresolved-module', name }); return; }
      mounted.add(name);
      for (const d of parsed[module.file].declarations.filter(d => d.owner === name)) {
        if (d.route === null) { diagnostics.push({ file: module.file, line: d.line, kind: 'dynamic-route' }); continue; }
        const route = (prefix + '/' + d.route).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
        if (d.kind === 'module') mount(d.targetClass, route, [...chain, name]);
        else {
          const widget = findClass(d.targetClass);
          const file = widget?.file ?? module.file;
          routes.push({ id: routeId('flutter', file, route), platform: 'flutter', route, file, declarationFile: module.file, widget: d.targetClass, evidence: 'inferred', dependencies: closure([file, module.file], imports) });
        }
      }
    }
    if (classes.some(c => c.name === adapter.rootModule)) mount(adapter.rootModule, '');
    for (const c of classes.filter(c => c.module && !mounted.has(c.name))) diagnostics.push({ file: c.file, kind: 'unmounted-module', name: c.name });
    for (const c of classes.filter(c => c.widget && /(?:Page|Screen)$/.test(c.name) && !routes.some(r => r.platform === 'flutter' && r.widget === c.name))) {
      routes.push({ id: routeId('flutter', c.file, c.name), platform: 'flutter', route: `widget:${c.name}`, file: c.file, widget: c.name, evidence: 'inferred', dependencies: closure([c.file], imports) });
    }
  }
  const unique = [...new Map(routes.map(r => [r.id, r])).values()].sort((a,b) => a.id.localeCompare(b.id));
  const edges = [];
  for (const r of unique) for (const a of actions.filter(a => a.action === 'navigate' && r.dependencies.includes(a.file))) {
    const normalized = a.target?.split(/[?#]/)[0]?.replace(/\/$/, '') || a.target;
    const targets = unique.filter(to => to.platform === r.platform && (to.route.replace(/\/$/, '') || '/') === normalized);
    edges.push({ from: r.id, action: a.id, target: a.target, to: targets.map(t => t.id), resolution: targets.length === 1 ? 'resolved' : a.target && /^(https?:|mailto:|tel:)/.test(a.target) ? 'external' : 'unresolved', evidence: 'inferred' });
  }
  return { routes: unique, actions, edges, diagnostics, imports };
}

export class NavigationIndex {
  constructor({ repo, config = '.ui-journey.json', cache } = {}) { this.repo = path.resolve(repo); this.configFile = safe.parse(config); this.cache = cache; this.entries = {}; this.queue = Promise.resolve(); }
  sync(options = {}) {
    const task = this.queue.then(() => this.refresh(options)); this.queue = task.catch(() => {}); return task;
  }
  async refresh({ revision } = {}) {
    if (!this.loaded) {
      if (this.cache) try { const saved = JSON.parse(await fs.readFile(this.cache, 'utf8')); if (saved.version === 2 && saved.repo === this.repo) this.entries = saved.entries; } catch {}
      this.loaded = true;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const tree = await readTree(this.repo, revision, this.configFile), parsed = {}, entries = {}; let reused = 0, count = 0;
      for (const [file, bytes] of Object.entries(tree.sources)) {
        if (!code(file)) continue;
        const key = tree.hashes[file];
        if (this.entries[file]?.hash === key) { parsed[file] = this.entries[file].parsed; reused++; }
        else { parsed[file] = file.endsWith('.dart') ? extractFlutter(file, bytes.toString('utf8')) : extractWeb(file, bytes.toString('utf8')); count++; }
        entries[file] = { hash: key, parsed: parsed[file] };
      }
      const assembled = assemble(tree, parsed);
      if (!revision) { const check = await readTree(this.repo, undefined, this.configFile); if (check.contentHash !== tree.contentHash || check.head !== tree.head) continue; }
      const graph = { schema: 'ui-navigation/v1', project: tree.config.project, configSource: tree.configSource, revision: tree.revision, dirty: tree.dirty, contentHash: tree.contentHash, indexedAt: new Date().toISOString(), status: 'current', evidence: 'inferred', fileHashes: tree.hashes,
        stats: { files: Object.keys(tree.sources).length, parsed: count, reused, deleted: Object.keys(this.entries).filter(f => !entries[f]).length }, ...assembled };
      this.entries = entries; this.graph = graph;
      if (this.cache) { await fs.mkdir(path.dirname(this.cache), { recursive: true }); const temp = this.cache + '.' + randomUUID(); await fs.writeFile(temp, JSON.stringify({ version: 2, repo: this.repo, entries })); await fs.rename(temp, this.cache); }
      return graph;
    }
    throw new Error('Source changed repeatedly while indexing; retry when edits settle');
  }
}

export function compareNavigation(before, after) {
  if (before.project !== after.project) throw new Error('Cannot compare different projects');
  const files = [...new Set([...Object.keys(before.fileHashes), ...Object.keys(after.fileHashes)])].filter(f => before.fileHashes[f] !== after.fileHashes[f]);
  const changed = new Set(files);
  const globalChange = files.some(f => /(?:\.ui-journey\.json|package(?:-lock)?\.json|pnpm-lock\.yaml|pubspec\.(?:yaml|lock)|next\.config\.|\/styles\/)/.test(f));
  const affectedRoutes = [...new Map([...before.routes, ...after.routes].filter(r => globalChange || r.dependencies.some(f => changed.has(f))).map(r => [r.id, { id: r.id, route: r.route, platform: r.platform, file: r.file }])).values()];
  return { schema: 'ui-navigation-impact/v1', project: after.project, before: { revision: before.revision, contentHash: before.contentHash, dirty: before.dirty }, after: { revision: after.revision, contentHash: after.contentHash, dirty: after.dirty }, changedFiles: files, affectedRoutes, addedRoutes: after.routes.filter(r => !before.routes.some(b => b.id === r.id)).map(r => r.id), removedRoutes: before.routes.filter(r => !after.routes.some(a => a.id === r.id)).map(r => r.id), unresolved: after.edges.filter(e => e.resolution === 'unresolved').length, evidence: 'inferred' };
}
