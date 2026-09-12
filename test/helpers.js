import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EvidenceStore } from '../src/store.js';
export const flow = {
  id: 'help', title: 'Help', route: '/', profile: 'anonymous', effects: 'read-only', fixture: 'synthetic',
  initial: 'closed', entryFiles: ['src/help.js'], dependencies: ['src/button.js'],
  states: [{ id: 'closed', assertions: [{ kind: 'visible', locator: { role: 'button', name: 'Open answer' } }] },
    { id: 'open', assertions: [{ kind: 'visible', locator: { role: 'text', name: 'An answer' } }] }],
  transitions: [{ id: 'open-answer', from: 'closed', to: 'open', action: { kind: 'click', locator: { role: 'button', name: 'Open answer' } } }],
};
export const snapshot = (extra = {}) => ({ schema: 'ui-journey-snapshot/v1', project: 'demo', revision: 'a'.repeat(40), run: 'run-1',
  observedAt: '2026-01-01T00:00:00Z', source: { kind: 'imported', provenance: 'caller-supplied' },
  viewport: { name: 'desktop', width: 1440, height: 1000 }, flow,
  observations: [{ state: 'closed', status: 'verified' }, { state: 'open', transition: 'open-answer', status: 'verified' }], ...extra });
export async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-journey-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return new EvidenceStore(dir);
}
