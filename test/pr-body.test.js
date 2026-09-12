import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
test('English PR template accepts executed tests and rejects evidence outside Tests', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ui-journey-pr-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'body.md');
  const generate = tested => execFileSync(process.execPath, ['scripts/gen-pr-body.cjs',
    '--summary', 'English contribution workflow.', '--tested', tested], { cwd: root, encoding: 'utf8' });
  const validate = body => {
    writeFileSync(file, body);
    return spawnSync(process.execPath, ['scripts/validate-pr-body.cjs', '--body-file', file], { cwd: root, encoding: 'utf8' });
  };
  const body = generate('npm test: passed.');
  for (const heading of ['Acceptance Criteria', 'Covered Scenarios', 'Tests', 'Risks and Rollback'])
    assert.ok(body.includes(`## ${heading}`));
  assert.equal(validate(body).status, 0);
  const untested = generate('Not run.').replace('Describe limitations, compatibility, data/security effects and how to revert.', '- [x] Rollback reviewed.');
  const rejected = validate(untested);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Executed-test evidence required in the Tests section/);
  assert.notEqual(validate(body.replace('## Covered Scenarios', '## Coverage')).status, 0);
});
