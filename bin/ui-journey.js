#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NavigationIndex, compareNavigation } from '../src/navigation.js';
import { EvidenceStore, query, importGraph, importSnapshot, createServer, auditUI } from '../src/index.js';
import { readJson } from '../src/store.js';
import { summarize } from '../src/query.js';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: Object.fromEntries(
    ['store', 'project', 'graph', 'images', 'run', 'observed-at', 'pr', 'side', 'file', 'args', 'flow-file', 'revision', 'origin', 'viewport', 'channel', 'repo', 'config', 'output', 'before', 'after', 'interval'].map(k => [k, { type: 'string' }])) });
  const store = new EvidenceStore(values.store ?? path.join(os.homedir(), '.ui-journey', 'store'));
  const command = positionals[0];
  let result;
  const repo = values.repo ?? (command === 'serve' && await fs.access(path.resolve('.ui-journey.json')).then(() => true, () => false) ? process.cwd() : undefined);
  const index = repo ? new NavigationIndex({ repo, config: values.config, cache: path.join(values.store ?? path.join(os.homedir(), '.ui-journey', 'store'), 'navigation-cache', createHash('sha256').update(path.resolve(repo)).digest('hex') + '.json') }) : undefined;
  if (command === 'serve') {
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    if (index) {
      const interval = Number(values.interval ?? 5000);
      if (!Number.isSafeInteger(interval) || interval < 1000 || interval > 60000) throw new Error('Interval must be between 1000 and 60000 ms');
      let busy = false;
      const refresh = async () => { if (busy) return; busy = true; try { await index.sync(); } catch { process.stderr.write('UI index refresh failed; queries will retry and report errors.\n'); } finally { busy = false; } };
      void refresh(); setInterval(refresh, interval).unref();
    }
    await createServer(store, { index }).connect(new StdioServerTransport());
  } else if (command === 'index') {
    if (!index) throw new Error('index requires --repo');
    result = await index.sync({ revision: values.revision });
    if (values.output) { await fs.mkdir(path.dirname(path.resolve(values.output)), { recursive: true }); await fs.writeFile(values.output, JSON.stringify(result, null, 2) + '\n'); result = { status: result.status, revision: result.revision, dirty: result.dirty, contentHash: result.contentHash, routes: result.routes.length, actions: result.actions.length, stats: result.stats }; }
  } else if (command === 'compare-index') {
    result = compareNavigation(await readJson(values.before), await readJson(values.after));
    if (values.output) { await fs.mkdir(path.dirname(path.resolve(values.output)), { recursive: true }); await fs.writeFile(values.output, JSON.stringify(result, null, 2) + '\n'); }
  } else if (command === 'query') result = await query(store, positionals[1], JSON.parse(values.args ?? '{}'));
  else if (command === 'audit') result = await auditUI(store, JSON.parse(values.args ?? '{}'), { index });
  else if (command === 'import-graph') result = await importGraph(store, { graph: values.graph, images: values.images, project: values.project,
    run: values.run, observedAt: values['observed-at'] ?? null, pr: values.pr ? Number(values.pr) : undefined, side: values.side });
  else if (command === 'import') result = await importSnapshot(store, values.file, values.images);
  else if (command === 'validate') {
    const { validateFlow } = await import('../src/browser.js');
    const saved = await validateFlow(store, { project: values.project, revision: values.revision, flow: await readJson(values['flow-file']), origin: values.origin,
      viewport: values.viewport, channel: values.channel, run: values.run });
    result = summarize(saved);
    if (result.result !== 'verified') process.exitCode = 1;
  } else if (command === 'help' || !command) result = {
    commands: ['serve --store PATH [--repo CHECKOUT] [--config .ui-journey.json] [--interval 5000]', 'index --repo CHECKOUT [--revision SHA] [--output FILE]', 'compare-index --before FILE --after FILE [--output FILE]', 'query TOOL --args JSON --store PATH', 'import --file SNAPSHOT --images DIR --store PATH',
      'audit --args JSON --store PATH [--repo CHECKOUT] [--config .ui-journey.json]',
      'import-graph --graph FILE --images DIR --project ID --run ID --store PATH [--observed-at ISO] [--pr N] [--side before|after]',
      'validate --flow-file FILE --origin http://127.0.0.1:PORT --project ID --revision FULL_SHA --store PATH [--viewport desktop|mobile] [--channel chrome|msedge]'],
  };
  else throw new Error('Unknown command; use help');
  if (result) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  // stdout is reserved for JSON / MCP frames. Avoid echoing imported data.
  const message = error.name === 'ZodError' ? 'Invalid input schema; check the documented limits and required fields.' : error.message;
  process.stderr.write(`ui-journey: ${message}\n`);
  process.exitCode = 1;
}
