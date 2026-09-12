import { z } from 'zod';

const selection = { project: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/) };
export function registerNavigationTools(server, index) {
  const definitions = {
    get_index_status: { description: 'Check the configured checkout and refresh its incremental UI index. Reports exact HEAD, content hash, dirty state, diagnostics and coverage limits. Does not execute UI.', schema: z.object(selection) },
    get_navigation_map: { description: 'Refresh and read inferred UI routes or actions from the configured checkout. This static map is separate from executed flows and screenshots. No caller-controlled filesystem paths.', schema: z.object({ ...selection, kind: z.enum(['routes', 'actions', 'edges', 'diagnostics']).default('routes'), file: z.string().max(240).optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(20) }) },
    get_navigation_impact: { description: 'Refresh the index and find potentially affected UI routes through recorded dependencies. Use CI comparison for removed dependencies and historical changes.', schema: z.object({ ...selection, files: z.array(z.string().min(1).max(240)).min(1).max(200), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(20) }) },
  };
  for (const [name, def] of Object.entries(definitions)) server.registerTool(name, { description: def.description, inputSchema: def.schema.strict(), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async args => {
    try {
      let result;
      if (!index) result = { status: 'not_configured', guidance: 'Start serve with --repo pointing to a checkout containing .ui-journey.json. Configure CI to reconcile exact revisions and publish validated screenshots in the PR body. See docs/ci-integration.md.' };
      else {
        const graph = await index.sync();
        if (graph.project !== args.project) result = { status: 'project_not_configured' };
        else {
          const { project, revision, contentHash, dirty, indexedAt, status } = graph;
          result = { project, revision, contentHash, dirty, indexedAt, status, evidence: 'inferred', exhaustive: false };
          if (name === 'get_index_status') Object.assign(result, { stats: graph.stats, routes: graph.routes.length, actions: graph.actions.length, unresolved: graph.edges.filter(e => e.resolution === 'unresolved').length, diagnostics: graph.diagnostics.length, ciGuidance: 'Reconcile exact base/head revisions in CI; attach validated before/after screenshots in a managed PR body block. Missing execution must stay explicit.' });
          else {
            let items = name === 'get_navigation_impact' ? graph.routes.filter(r => r.dependencies.some(f => args.files.includes(f))) : graph[args.kind];
            if (args.file) items = items.filter(item => item.file === args.file || item.dependencies?.includes(args.file));
            const sliced = items.slice(args.offset, args.offset + args.limit);
            Object.assign(result, { items: sliced, total: items.length, nextOffset: args.offset + sliced.length < items.length ? args.offset + sliced.length : null });
          }
        }
      }
      return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch { return { isError: true, content: [{ type: 'text', text: 'UI index refresh failed. No cached graph is being reported as current. Check source configuration, file limits and repository accessibility with the index CLI.' }] }; }
  });
}
