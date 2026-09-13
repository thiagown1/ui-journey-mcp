import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture, snapshot } from './helpers.js';

test('real stdio MCP initialization, tool discovery, query, errors and missing images', async t => {
  const store = await fixture(t); await store.put(snapshot());
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../bin/ui-journey.js', import.meta.url)), 'serve', '--store', store.root], stderr: 'pipe' });
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 13);
  const indexStatus = await client.callTool({ name: 'get_index_status', arguments: { project: 'demo' } });
  assert.equal(indexStatus.structuredContent.status, 'not_configured');
  assert.ok(tools.every(tool => tool.annotations.readOnlyHint && !tool.annotations.openWorldHint));
  const result = await client.callTool({ name: 'get_flow_evidence', arguments: { project: 'demo', flow: 'help' } });
  assert.equal(result.structuredContent.runs[0].result, 'verified');
  const audit = await client.callTool({ name: 'audit_ui', arguments: { project: 'demo', flow: 'help', revision: 'a'.repeat(40) } });
  assert.equal(audit.structuredContent.schema, 'ui-audit/v1');
  assert.equal(audit.structuredContent.navigation.reason, 'index_not_configured');
  assert.equal(audit.structuredContent.design.verdict, 'not_evaluated');
  const invalidAudit = await client.callTool({ name: 'audit_ui', arguments: { project: 'demo', flow: 'help' } });
  assert.equal(invalidAudit.isError, true);
  const bad = await client.callTool({ name: 'get_flow_evidence', arguments: { project: '../demo', flow: 'help' } });
  assert.equal(bad.isError, true);
  const image = await client.callTool({ name: 'get_evidence_image', arguments: { project: 'demo', digest: 'a'.repeat(64) } });
  assert.equal(image.isError, true);
  assert.equal((await client.listResourceTemplates()).resourceTemplates[0].uriTemplate, 'ui-evidence://{project}/{digest}');
});
