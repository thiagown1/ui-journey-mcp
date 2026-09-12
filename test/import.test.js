import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { flow, snapshot, fixture } from './helpers.js';
import { importGraph } from '../src/import.js';
import { query } from '../src/query.js';

test('imports declared maps without claiming execution or fabricating observation time', async t => {
  const store = await fixture(t), file = path.join(store.root, 'graph.json');
  await fs.writeFile(file, JSON.stringify({ schema: 'ui-graph/v1', sha: 'a'.repeat(40), journeys: [flow] }));
  assert.equal((await importGraph(store, { graph: file, project: 'demo', run: 'ci-1' })).imported, 2);
  const result = await query(store, 'get_flow_evidence', { project: 'demo', flow: 'help' });
  assert.equal(result.runs[0].observedAt, null);
  assert.equal(result.runs[0].result, 'unverified');
});
test('old executed contract survives deletion from the new declared map', async t => {
  const store = await fixture(t), file = path.join(store.root, 'graph.json');
  await store.put(snapshot());
  await fs.writeFile(file, JSON.stringify({ schema: 'ui-graph/v1', sha: 'b'.repeat(40), journeys: [],
    executedContracts: [{ journey: flow, origin: 'base' }], observations: [{ journey: 'help', viewport: 'desktop', state: 'open', transition: 'open-answer',
      status: 'failed', sha: 'b'.repeat(40), profile: 'anonymous' }] }));
  await importGraph(store, { graph: file, project: 'demo', run: 'ci-2', pr: 42, side: 'after' });
  const result = await query(store, 'compare_flow', { project: 'demo', flow: 'help', before: 'a'.repeat(40), after: 'b'.repeat(40) });
  assert.equal(result.contract.flowRemoved, true);
  assert.deepEqual(result.contract.removedTransitions, ['open-answer']);
  assert.equal(result.after.runs[0].result, 'failed');
  assert.equal((await query(store, 'get_change_evidence', { project: 'demo', pr: 42 })).total, 2);
});
test('rejects mixed revision observations and unsafe image filenames', async t => {
  const store = await fixture(t), file = path.join(store.root, 'graph.json');
  const graph = { schema: 'ui-graph/v1', sha: 'a'.repeat(40), journeys: [flow], observations: [{ journey: 'help', viewport: 'desktop', state: 'closed', status: 'verified', sha: 'b'.repeat(40), profile: 'anonymous' }] };
  await fs.writeFile(file, JSON.stringify(graph));
  await assert.rejects(importGraph(store, { graph: file, project: 'demo', run: 'ci-1' }), /mismatch/);
  graph.observations[0].sha = graph.sha; graph.observations[0].image = '../secret.png';
  await fs.writeFile(file, JSON.stringify(graph));
  await assert.rejects(importGraph(store, { graph: file, images: store.root, project: 'demo', run: 'ci-1' }));
  assert.deepEqual(await store.list('demo'), []);
});
