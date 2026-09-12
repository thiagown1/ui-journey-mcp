#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { EvidenceStore, query, importGraph, importSnapshot, createServer } from '../src/index.js';
import { readJson } from '../src/store.js';
import { summarize } from '../src/query.js';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: Object.fromEntries(
    ['store', 'project', 'graph', 'images', 'run', 'observed-at', 'pr', 'side', 'file', 'args', 'flow-file', 'revision', 'origin', 'viewport', 'channel'].map(k => [k, { type: 'string' }])) });
  const store = new EvidenceStore(values.store ?? path.join(os.homedir(), '.ui-journey', 'store'));
  const command = positionals[0];
  let result;
  if (command === 'serve') {
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    await createServer(store).connect(new StdioServerTransport());
  } else if (command === 'query') result = await query(store, positionals[1], JSON.parse(values.args ?? '{}'));
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
    commands: ['serve --store PATH', 'query TOOL --args JSON --store PATH', 'import --file SNAPSHOT --images DIR --store PATH',
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
