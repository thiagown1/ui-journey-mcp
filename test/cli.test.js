import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, snapshot } from './helpers.js';
const cli = fileURLToPath(new URL('../bin/ui-journey.js', import.meta.url));
test('CLI import and query share the MCP contract and survive source file removal', async t => {
  const store = await fixture(t), file = path.join(store.root, 'input.json');
  await fs.writeFile(file, JSON.stringify(snapshot()));
  const imported = JSON.parse(execFileSync(process.execPath, [cli, 'import', '--file', file, '--store', store.root], { encoding: 'utf8' }));
  assert.equal(imported.imported, 1);
  await fs.unlink(file);
  const result = JSON.parse(execFileSync(process.execPath, [cli, 'query', 'get_flow_evidence', '--args', JSON.stringify({ project: 'demo', flow: 'help' }), '--store', store.root], { encoding: 'utf8' }));
  assert.equal(result.status, 'found'); assert.equal(result.runs[0].result, 'verified');
  const invalid = spawnSync(process.execPath, [cli, 'query', 'get_flow_evidence', '--args', '{broken'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1); assert.equal(invalid.stdout, ''); assert.match(invalid.stderr, /ui-journey:/);
});
