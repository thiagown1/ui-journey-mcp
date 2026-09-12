import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { NavigationIndex, compareNavigation } from '../src/navigation.js';
import { extractFlutter } from '../src/discovery.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'journey-index-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test');
  const put = async (file, text) => { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), text); };
  await put('.ui-journey.json', JSON.stringify({ schema: 'ui-journey-project/v1', project: 'demo', webRoots: ['web'], flutterRoots: [{ root: 'mobile', package: 'example' }] }));
  await put('web/app/page.tsx', `import { Shared } from './shared'; export default function Home(){return <Shared/>}`);
  await put('web/app/shared.tsx', `export function Shared(){return <a href="/members">Members</a>}`);
  await put('web/app/members/page.tsx', `export default function Page(){return <button onClick={exportMembers}>Export</button>}`);
  await put('mobile/lib/app.dart', `class AppModule extends Module { void routes(r) { r.module('/profile', module: ProfileModule()); } }`);
  await put('mobile/lib/profile.dart', `class ProfileModule extends Module { void routes(r) { r.child('/edit', child: (_) => EditPage()); } } class EditPage extends StatelessWidget { void go(){ Modular.to.pushNamed('/profile/edit'); } }`);
  git('add', '.'); git('commit', '-qm', 'fixture');
  return { root, git, put, index: new NavigationIndex({ repo: root, cache: path.join(root, '.git', 'ui-cache.json') }) };
}
test('indexes web and Flutter, incrementally invalidates dependencies, deletions and uncommitted additions', async t => {
  const f = await fixture(t);
  const first = await f.index.sync();
  assert.equal(first.dirty, false);
  assert.ok(first.routes.some(r => r.route === '/profile/edit' && r.platform === 'flutter'));
  assert.ok(first.edges.some(e => e.target === '/members' && e.from === first.routes.find(r => r.route === '/' && r.platform === 'web').id));
  assert.ok(first.actions.some(a => a.action === 'onClick'));
  const same = await f.index.sync();
  assert.equal(same.stats.parsed, 0);
  await f.put('web/app/shared.tsx', `export function Shared(){return <a href={destination}>Members</a>}`);
  const changed = await f.index.sync();
  assert.equal(changed.dirty, true); assert.equal(changed.stats.parsed, 1);
  assert.notEqual(changed.contentHash, first.contentHash);
  assert.ok(changed.edges.some(e => e.resolution === 'unresolved'));
  const impact = compareNavigation(first, changed);
  assert.ok(impact.affectedRoutes.some(r => r.route === '/'));
  await fs.unlink(path.join(f.root, 'web/app/members/page.tsx'));
  await f.put('web/app/new/page.tsx', 'export default function New(){return null}');
  const added = await f.index.sync();
  assert.ok(added.routes.some(r => r.route === '/new'));
  assert.ok(!added.routes.some(r => r.route === '/members'));
  assert.equal(added.stats.deleted, 1);
  const clean = await new NavigationIndex({ repo: f.root }).sync();
  assert.deepEqual(added.routes, clean.routes); assert.deepEqual(added.edges, clean.edges);
  const historic = await f.index.sync({ revision: first.revision });
  assert.equal(historic.dirty, false); assert.ok(historic.routes.some(r => r.route === '/members'));
  assert.ok(!historic.routes.some(r => r.route === '/new'));
});
test('ignores comments, marks dynamic destinations and does not treat array.push as navigation', async t => {
  const f = await fixture(t);
  await f.put('web/app/shared.tsx', `// router.push('/fake')\nconst a=[]; a.push('/fake'); router.push(computed); export const Shared=()=> <a href={'/members'} />;`);
  await f.put('mobile/lib/profile.dart', `// Modular.to.pushNamed('/fake');\nclass EditPage extends StatelessWidget { void go(){ Modular.to.pushNamed('/profile/$id'); } }`);
  const graph = await f.index.sync();
  assert.ok(!graph.actions.some(a => a.target === '/fake'));
  assert.ok(graph.actions.filter(a => a.action === 'navigate').some(a => a.target === null));
  assert.ok(graph.diagnostics.some(d => d.kind === 'unresolved-module'));
  await f.put('.ui-journey.json', JSON.stringify({ schema: 'ui-journey-project/v1', project: 'demo', webRoots: ['../outside'] }));
  await assert.rejects(() => f.index.sync());
});

test('Flutter nested module routes survive interpolation and block-bodied builders', () => {
  const result = extractFlutter('app.dart', `class AppModule extends Module {
    void routes(r) { log('User: \${user ?? 'none'}');
      r.child(Modular.initialRoute, child: (_) { log('hello'); return const RootPage(); }, children: [ModuleRoute('/profile', module: ProfileModule())]);
    }
  }`);
  assert.deepEqual(result.declarations.map(d => [d.kind, d.route, d.targetClass]), [['child', '/', 'RootPage'], ['module', '/profile', 'ProfileModule']]);
});

test('real MCP connection refreshes edited checkout, isolates projects and fails visibly on invalid configuration', async t => {
  const f = await fixture(t);
  const client = new Client({ name: 'navigation-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../bin/ui-journey.js', import.meta.url)), 'serve', '--repo', f.root, '--store', path.join(f.root, '.git', 'store')], stderr: 'pipe' }));
  t.after(() => client.close());
  const call = (name, args = {}) => client.callTool({ name, arguments: { project: 'demo', ...args } });
  const initial = (await call('get_index_status')).structuredContent;
  assert.equal(initial.status, 'current');
  await f.put('web/app/fresh/page.tsx', 'export default function Page(){ return null; }');
  const updated = (await call('get_navigation_map', { limit: 100 })).structuredContent;
  assert.ok(updated.items.some(r => r.route === '/fresh'));
  assert.notEqual(updated.contentHash, initial.contentHash);
  assert.equal((await call('get_index_status', { project: 'another' })).structuredContent.status, 'project_not_configured');
  await f.put('.ui-journey.json', '{}');
  assert.equal((await call('get_index_status')).isError, true);
});
