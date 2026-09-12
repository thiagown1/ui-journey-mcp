import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EvidenceStore } from '../src/store.js';
import { query } from '../src/query.js';

import { flow, snapshot, fixture } from './helpers.js';
test('flow evidence is independent of PRs; later failure wins over old approval', async t => {
  const store = await fixture(t);
  await store.put(snapshot());
  await store.put(snapshot({ run: 'run-2', observedAt: '2026-01-02T00:00:00Z', observations: [{ state: 'closed', status: 'failed' }] }));
  const result = await query(store, 'get_flow_evidence', { project: 'demo', flow: 'help' });
  assert.equal(result.status, 'found');
  assert.equal(result.runs[0].run, 'run-2');
  assert.equal(result.runs[0].result, 'failed');
  assert.equal(result.freshness, 'unknown');
});
test('a map is not execution evidence; unknown exact revision never falls back', async t => {
  const store = await fixture(t);
  await store.put(snapshot({ source: { kind: 'mapped', provenance: 'caller-supplied' }, observations: [] }));
  const result = await query(store, 'get_flow_evidence', { project: 'demo', flow: 'help', revision: 'a'.repeat(40), currentRevision: 'b'.repeat(40) });
  assert.equal(result.runs[0].result, 'unverified');
  assert.equal(result.freshness, 'stale');
  assert.equal((await query(store, 'get_flow_evidence', { project: 'demo', flow: 'help', revision: 'b'.repeat(40) })).status, 'not_found');
});
test('revision ordering cannot be inferred from timestamps or hashes', async t => {
  const store = await fixture(t);
  await store.put(snapshot());
  await store.put(snapshot({ revision: 'b'.repeat(40) }));
  const result = await query(store, 'get_flow_evidence', { project: 'demo', flow: 'help' });
  assert.equal(result.status, 'selection_required');
  assert.equal(result.reason, 'revision_required');
});
test('comparison detects removed action and missing evidence; impact follows dependencies', async t => {
  const store = await fixture(t);
  await store.put(snapshot());
  await store.put(snapshot({ revision: 'b'.repeat(40), flow: { ...flow, states: [flow.states[0]], transitions: [] }, observations: [] }));
  const result = await query(store, 'compare_flow', { project: 'demo', flow: 'help', before: 'a'.repeat(40), after: 'b'.repeat(40) });
  assert.deepEqual(result.contract.removedTransitions, ['open-answer']);
  assert.equal(result.after.runs[0].result, 'unverified');
  const impact = await query(store, 'get_ui_impact', { project: 'demo', revision: 'a'.repeat(40), files: ['src/button.js'] });
  assert.deepEqual(impact.flows.map(f => f.flow), ['help']);
});
test('immutable imports are concurrent and idempotent, with project isolation', async t => {
  const store = await fixture(t);
  const results = await Promise.all(Array.from({ length: 6 }, () => store.put(snapshot())));
  assert.equal(new Set(results.map(r => r.recordId)).size, 1);
  assert.equal((await store.list('demo')).length, 1);
  assert.deepEqual(await store.list('another'), []);
  await assert.rejects(store.list('../demo'));
});
test('invalid graph and forged observations are rejected', async t => {
  const store = await fixture(t);
  await assert.rejects(store.put(snapshot({ flow: { ...flow, transitions: [] } })), /Unreachable/);
  await assert.rejects(store.put(snapshot({ observations: [{ state: 'invented', status: 'verified' }] })), /Observation/);
});
test('trace uses a bounded shortest path, and reports no path explicitly', async t => {
  const store = await fixture(t); await store.put(snapshot());
  assert.deepEqual((await query(store, 'trace_journey', { project: 'demo', flow: 'help', to: 'open' })).transitions, ['open-answer']);
  assert.equal((await query(store, 'trace_journey', { project: 'demo', flow: 'help', from: 'open', to: 'closed' })).status, 'no_path');
});
