import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { auditUI } from '../src/audit.js';
import { hash } from '../src/store.js';
import { fixture, snapshot, flow } from './helpers.js';

const args = { project: 'demo', flow: 'help', revision: 'a'.repeat(40) };
const graph = (extra = {}) => ({ project: 'demo', revision: args.revision, dirty: false,
  configSource: 'revision', evidence: 'inferred', contentHash: 'index-hash', diagnostics: [],
  routes: [{ id: 'home', route: '/home', platform: 'web', file: 'src/home.js' },
    { id: 'help', route: '/', platform: 'web', file: 'src/help.js' }],
  edges: [{ from: 'home', to: ['help'], resolution: 'resolved', target: '/', action: 'link', file: 'src/home.js' }], ...extra });
const indexFor = value => ({ sync: async input => { assert.deepEqual(input, { revision: args.revision }); return value; } });

test('audits exact-revision entry paths and declared return paths without claiming runtime proof', async t => {
  const store = await fixture(t); await store.put(snapshot());
  const result = await auditUI(store, { ...args, entryRoutes: ['/home'] }, { index: indexFor(graph()) });
  assert.equal(result.status, 'completed');
  assert.equal(result.exhaustive, false);
  assert.equal(result.navigation.paths[0].status, 'path_found');
  assert.deepEqual(result.navigation.paths[0].routes, ['/home', '/']);
  assert.equal(result.navigation.evidence, 'inferred');
  assert.ok(result.findings.some(f => f.code === 'no_return_path' && f.state === 'open' && f.kind === 'review'));
  assert.equal(result.execution.status, 'recorded_verified');
  assert.equal(result.design.status, 'needs_evidence');
  const terminal = await auditUI(store, { ...args, terminalStates: ['open'], checks: ['flow'] });
  assert.ok(!terminal.findings.some(f => f.code === 'no_return_path'));
  assert.equal(terminal.navigation.status, 'not_requested');
});

test('unknown entry routes and unresolved destinations are gaps, not confirmed broken navigation', async t => {
  const store = await fixture(t); await store.put(snapshot());
  const result = await auditUI(store, { ...args, entryRoutes: ['/home', '/missing'] }, { index: indexFor(graph({
    edges: [{ from: 'home', to: [], resolution: 'unresolved', target: null, action: 'dynamic', file: 'src/home.js' }],
  })) });
  assert.equal(result.navigation.paths[0].status, 'no_inferred_path');
  assert.equal(result.navigation.paths[1].status, 'entry_not_resolved');
  assert.ok(result.findings.some(f => f.code === 'unresolved_navigation' && f.kind === 'gap'));
  assert.ok(result.findings.every(f => f.kind !== 'failure'));
});

test('unrelated changed files never select pilot screenshots or broaden the audit', async t => {
  const store = await fixture(t); await store.put(snapshot());
  const result = await auditUI(store, { ...args, files: ['.github/workflows/ui-journey.yml'] }, {
    index: { sync: () => { throw new Error('must not index an unrelated flow'); } },
  });
  assert.equal(result.status, 'not_affected');
  assert.equal(result.scope.basis, 'recorded-dependencies-only');
  assert.equal(result.design, undefined);
  assert.equal(result.evidence, undefined);
});

test('missing revisions, ambiguous runs and removed declarations never fall back to older evidence', async t => {
  const store = await fixture(t); await store.put(snapshot());
  assert.equal((await auditUI(store, { ...args, revision: 'b'.repeat(40) })).status, 'not_found');
  await store.put(snapshot({ run: 'unknown', observedAt: null }));
  assert.equal((await auditUI(store, args)).status, 'selection_required');
  const removed = await store.put(snapshot({ run: 'removed', declaredFlow: null }));
  assert.equal((await auditUI(store, { ...args, run: removed.run })).status, 'flow_removed');
});

test('stale, dirty, fallback, wrong-project and failed indexes remain unavailable', async t => {
  const store = await fixture(t); await store.put(snapshot());
  for (const change of [{ revision: 'b'.repeat(40) }, { dirty: true }, { configSource: 'worktree-fallback' }, { project: 'other' }]) {
    const result = await auditUI(store, { ...args, entryRoutes: ['/home'] }, { index: indexFor(graph(change)) });
    assert.equal(result.navigation.status, 'unavailable');
    assert.equal(result.navigation.paths, undefined);
  }
  const failed = await auditUI(store, args, { index: { sync: async () => { throw new Error('private filesystem path'); } } });
  assert.equal(failed.navigation.reason, 'index_refresh_failed');
  assert.ok(!JSON.stringify(failed).includes('private filesystem path'));
});

test('reports observed failures and untested changed contracts separately from flow suggestions', async t => {
  const store = await fixture(t);
  await store.put(snapshot({ declaredFlow: { ...flow, title: 'Changed help' }, observations: [
    { state: 'closed', status: 'verified' }, { state: 'open', transition: 'open-answer', status: 'failed' },
  ] }));
  const result = await auditUI(store, args);
  assert.equal(result.execution.status, 'recorded_failed');
  assert.equal(result.execution.contractMatches, false);
  assert.ok(result.findings.some(f => f.code === 'execution_failed' && f.kind === 'failure'));
  assert.ok(result.findings.some(f => f.code === 'contract_not_executed' && f.kind === 'gap'));
  assert.equal(result.design.status, 'contract_not_executed');
});

// Generate an actual blank RGBA PNG without depending on a browser installation.
function png() {
  const chunk = (name, data) => {
    const payload = Buffer.concat([Buffer.from(name), data]);
    let crc = 0xffffffff;
    for (const byte of payload) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length); payload.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(100); header.writeUInt32BE(100, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(100 * (100 * 4 + 1)))), chunk('IEND', Buffer.alloc(0))]);
}
const environment = { browserVersion: 'synthetic', locale: 'en-US', timezone: 'UTC', fixedTime: '2026-01-01T00:00:00Z' };
async function withImages(store, extra = {}) {
  const bytes = png(), digest = hash(bytes);
  await store.put(snapshot({ viewport: { name: 'desktop', width: 100, height: 100 }, environment,
    observations: [{ state: 'closed', status: 'verified', image: digest }, { state: 'open', transition: 'open-answer', status: 'verified', image: digest }], ...extra }), new Map([[digest, bytes]]));
  return digest;
}

test('design review returns exact evidence and explicit reference context, never an aesthetic verdict', async t => {
  const store = await fixture(t); const digest = await withImages(store);
  await withImages(store, { revision: 'b'.repeat(40) });
  const result = await auditUI(store, { ...args, designReference: { flow: 'help', revision: 'b'.repeat(40) }, designRules: ['Primary actions use the shared button component.'] });
  assert.equal(result.design.status, 'ready_for_agent_review');
  assert.equal(result.design.pairs.length, 1);
  assert.equal(result.design.current.runs[0].states[0].images[0].digest, digest);
  assert.equal(result.design.verdict, 'not_evaluated');
  assert.ok(result.design.reviewTasks.some(s => s.includes('comparable')));
  await fs.unlink(path.join(store.root, 'demo', 'images', `${digest}.png`));
  const missing = await auditUI(store, { ...args, designRules: ['Use consistent spacing.'] });
  assert.equal(missing.design.status, 'needs_evidence');
  assert.deepEqual(missing.design.current.runs[0].states[0].images, []);
});

test('design reference with missing or mismatched environment cannot become a comparison', async t => {
  const store = await fixture(t); await withImages(store);
  await withImages(store, { revision: 'b'.repeat(40), environment: undefined });
  const unknown = await auditUI(store, { ...args, designReference: { flow: 'help', revision: 'b'.repeat(40) } });
  assert.equal(unknown.design.status, 'incomparable_context');
  assert.deepEqual(unknown.design.pairs, []);
  await withImages(store, { revision: 'c'.repeat(40), environment: { ...environment, locale: 'pt-BR' } });
  const mismatch = await auditUI(store, { ...args, designReference: { flow: 'help', revision: 'c'.repeat(40) } });
  assert.equal(mismatch.design.status, 'incomparable_context');
  const noReference = await auditUI(store, args);
  assert.equal(noReference.design.status, 'needs_design_standard');
});

test('rejects invalid options and reports a meaningful step-budget suggestion', async t => {
  const store = await fixture(t); await store.put(snapshot({ flow: { ...flow,
    states: [...flow.states, { id: 'done', assertions: flow.states[1].assertions }],
    transitions: [...flow.transitions, { ...flow.transitions[0], id: 'finish', from: 'open', to: 'done' }],
  } }));
  await assert.rejects(() => auditUI(store, { project: 'demo', flow: 'help' }));
  await assert.rejects(() => auditUI(store, { ...args, terminalStates: ['unknown'] }));
  await assert.rejects(() => auditUI(store, { ...args, files: ['../secrets'] }));
  await assert.rejects(() => auditUI(store, { ...args, arbitraryPath: '/tmp/file' }));
  const result = await auditUI(store, { ...args, maxSteps: 1 });
  assert.ok(result.findings.some(f => f.code === 'step_budget_exceeded' && f.state === 'done' && f.steps === 2));
});

test('CLI audit uses the same exact-revision contract', async t => {
  const store = await fixture(t); await store.put(snapshot());
  const output = execFileSync(process.execPath, [fileURLToPath(new URL('../bin/ui-journey.js', import.meta.url)),
    'audit', '--store', store.root, '--args', JSON.stringify({ ...args, checks: ['flow'] })], { encoding: 'utf8' });
  assert.equal(JSON.parse(output).schema, 'ui-audit/v1');
});

test('conflicting declared maps across viewports require explicit record reconciliation', async t => {
  const store = await fixture(t); await store.put(snapshot());
  await store.put(snapshot({ viewport: { name: 'mobile', width: 390, height: 844 }, declaredFlow: { ...flow, title: 'A different declaration' } }));
  const result = await auditUI(store, args);
  assert.equal(result.status, 'selection_required');
  assert.equal(result.selection.reason, 'conflicting_records');
  assert.equal(result.design, undefined);
});
