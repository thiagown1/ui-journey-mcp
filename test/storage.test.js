import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, snapshot } from './helpers.js';
import { hash, validatePng } from '../src/store.js';
import { query } from '../src/query.js';

test('tampered snapshot bytes are rejected rather than served as evidence', async t => {
  const store = await fixture(t), saved = await store.put(snapshot());
  await fs.appendFile(path.join(store.root, 'demo/records', `${saved.recordId}.json`), ' ');
  await assert.rejects(store.list('demo'), /Corrupt/);
});
test('symlinked project directories are rejected before reads or writes', async t => {
  const store = await fixture(t), outside = path.join(store.root, 'outside');
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(store.root, 'demo'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(store.list('demo'), /symlinks/);
  await assert.rejects(store.put(snapshot()), /symlinks/);
  assert.deepEqual(await fs.readdir(outside), []);
});
test('malformed PNG, oversized image and missing referenced image fail closed', async t => {
  const store = await fixture(t);
  assert.throws(() => validatePng(Buffer.alloc(1024 * 1024 + 1)), /oversized/);
  const header = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(header); header.writeUInt32BE(13, 8); header.write('IHDR', 12); header.writeUInt32BE(1440, 16); header.writeUInt32BE(1000, 20);
  assert.throws(() => validatePng(header), /Incomplete/);
  const image = hash(header);
  await assert.rejects(store.put(snapshot({ observations: [{ state: 'closed', status: 'verified', image }] }), new Map([[image, header]])), /Incomplete/);
  await assert.rejects(store.put(snapshot({ observations: [{ state: 'closed', status: 'verified', image: 'a'.repeat(64) }] })));
  assert.deepEqual(await store.list('demo'), []);
});
test('unknown observation times and conflicting run records require explicit selection', async t => {
  const store = await fixture(t);
  await store.put(snapshot({ observedAt: null }));
  await store.put(snapshot({ run: 'run-2' }));
  assert.equal((await query(store, 'get_flow_evidence', { project: 'demo', flow: 'help' })).reason, 'run_required_unknown_time');
  assert.equal((await query(store, 'get_flow_evidence', { project: 'demo', flow: 'help', run: 'run-1' })).status, 'found');
  await store.put(snapshot({ run: 'run-2', observations: [{ state: 'closed', status: 'failed' }] }));
  assert.equal((await query(store, 'get_flow_evidence', { project: 'demo', flow: 'help', run: 'run-2' })).reason, 'conflicting_records');
});
test('pagination and empty coverage stay explicit', async t => {
  const store = await fixture(t);
  await store.put(snapshot()); await store.put(snapshot({ revision: 'b'.repeat(40) }));
  const result = await query(store, 'list_flows', { project: 'demo', limit: 1 });
  assert.equal(result.items.length, 1); assert.equal(result.nextOffset, 1); assert.equal(result.total, 2);
  assert.equal((await query(store, 'get_coverage_gaps', { project: 'demo', flow: 'missing' })).status, 'not_found');
  const comparison = await query(store, 'compare_flow', { project: 'demo', flow: 'help', before: 'a'.repeat(40), after: 'b'.repeat(40) });
  assert.equal(comparison.environmentComparable, null);
});
