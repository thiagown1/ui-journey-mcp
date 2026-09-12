import { z } from 'zod';
import { id, revision, relativePath } from './schema.js';
import { hash } from './store.js';

const selection = { project: id, flow: id, revision: revision.optional(), run: z.string().min(1).max(100).optional(), currentRevision: revision.optional() };
export const tools = {
  list_flows: { description: 'List mapped flows and available exact revisions. Mapping alone is not execution evidence.', schema: z.object({ project: id, revision: revision.optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(20) }) },
  get_flow: { description: 'Get the mapped states, transitions and source dependencies of a flow.', schema: z.object(selection) },
  get_flow_evidence: { description: 'Read stored flow evidence, screenshots and failures. Does not run a browser. Supply an exact revision when multiple versions exist.', schema: z.object(selection) },
  compare_flow: { description: 'Compare contracts and evidence for two exact revisions. This is a structural/status comparison, not an aesthetic image verdict.', schema: z.object({ project: id, flow: id, before: revision, after: revision, beforeRun: z.string().max(100).optional(), afterRun: z.string().max(100).optional() }) },
  trace_journey: { description: 'Find a shortest declared interaction path within a mapped flow. A path is not proof it passed.', schema: z.object({ ...selection, from: id.optional(), to: id }) },
  get_ui_impact: { description: 'Find mapped flows whose declared entry files or recorded dependency closures intersect changed files. Unknown coverage remains possible.', schema: z.object({ project: id, revision, files: z.array(relativePath).min(1).max(100), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(20) }) },
  get_coverage_gaps: { description: 'List unverified or failed mapped states/transitions for one flow. Does not claim exhaustive application coverage.', schema: z.object(selection) },
  get_change_evidence: { description: 'Find stored runs associated with a PR number and optionally an exact revision. PR metadata is supplied by the importer, not authenticated by this server.', schema: z.object({ project: id, pr: z.number().int().positive(), revision: revision.optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(20) }) },
};
function page(items, args) { return { items: items.slice(args.offset, args.offset + args.limit), total: items.length, nextOffset: items.length > args.offset + args.limit ? args.offset + args.limit : null }; }
const fingerprint = flow => hash(Buffer.from(JSON.stringify(flow)));
function choose(records, args) {
  let found = records.filter(r => r.flow.id === args.flow && (!args.revision || r.revision === args.revision) && (!args.run || r.run === args.run));
  if (!found.length) return { status: 'not_found', project: args.project, flow: args.flow, requestedRevision: args.revision ?? null };
  const revisions = [...new Set(found.map(r => r.revision))].sort();
  if (revisions.length > 1) return { status: 'selection_required', reason: 'revision_required', revisions };
  if (!args.run && new Set(found.map(r => r.run)).size > 1) {
    if (found.some(r => !r.observedAt)) return { status: 'selection_required', reason: 'run_required_unknown_time', runs: [...new Set(found.map(r => r.run))].sort() };
    const latest = Math.max(...found.map(r => Date.parse(r.observedAt)));
    found = found.filter(r => Date.parse(r.observedAt) === latest);
    if (new Set(found.map(r => r.run)).size > 1) return { status: 'selection_required', reason: 'run_required_tied_time', runs: [...new Set(found.map(r => r.run))].sort() };
  }
  if (new Set(found.map(r => fingerprint(r.flow))).size > 1 || new Set(found.map(r => r.viewport.name)).size !== found.length)
    return { status: 'selection_required', reason: 'conflicting_records', recordIds: found.map(r => r.recordId) };
  return { status: 'found', project: args.project, flow: args.flow, revision: revisions[0],
    freshness: args.currentRevision ? (args.currentRevision === revisions[0] ? 'matches_requested_revision' : 'stale') : 'unknown', records: found };
}
function aggregate(observations) {
  if (observations.some(o => o.status === 'failed')) return 'failed';
  if (observations.some(o => o.status === 'unavailable')) return 'unavailable';
  return observations.some(o => o.status === 'verified') ? 'verified' : 'unverified';
}
export function summarize(record) {
  const states = record.flow.states.map(s => {
    const observations = record.observations.filter(o => o.state === s.id);
    const status = aggregate(observations);
    // An earlier screenshot from a successful attempt is not evidence of the failed attempt.
    const images = status === 'verified' ? [...new Set(observations.map(o => o.image).filter(Boolean))].map(image => ({ digest: image, uri: `ui-evidence://${record.project}/${image}` })) : [];
    return { id: s.id, status, images };
  });
  const transitions = record.flow.transitions.map(e => ({ id: e.id, status: aggregate(record.observations.filter(o => o.transition === e.id)) }));
  const outcomes = [...states, ...transitions];
  const result = outcomes.some(o => o.status === 'failed') ? 'failed' : outcomes.every(o => o.status === 'verified') ? 'verified' : 'unverified';
  return { recordId: record.recordId, revision: record.revision, flow: record.flow.id, run: record.run, observedAt: record.observedAt,
    source: record.source, viewport: record.viewport, environment: record.environment ?? null, fixture: record.flow.fixture, profile: record.flow.profile, result, states, transitions };
}
function evidence(selected) {
  if (selected.status !== 'found') return selected;
  const { records, ...info } = selected;
  return { ...info, runs: records.map(summarize) };
}
export async function query(store, name, input) {
  if (!tools[name]) throw new Error('Unknown query');
  const args = tools[name].schema.strict().parse(input);
  const records = await store.list(args.project);
  if (name === 'list_flows') {
    const groups = new Map();
    for (const r of records.filter(r => !args.revision || r.revision === args.revision)) {
      const key = `${r.flow.id}:${r.revision}`;
      if (!groups.has(key)) groups.set(key, { flow: r.flow.id, title: r.flow.title, route: r.flow.route, revision: r.revision });
    }
    return { project: args.project, ...page([...groups.values()].sort((a, b) => `${a.flow}:${a.revision}`.localeCompare(`${b.flow}:${b.revision}`)), args) };
  }
  if (name === 'get_change_evidence') return { project: args.project, pr: args.pr, ...page(records.filter(r => r.source.pr === args.pr && (!args.revision || r.revision === args.revision)).map(summarize), args) };
  if (name === 'get_ui_impact') {
    const flows = new Map();
    for (const r of records.filter(r => r.revision === args.revision)) {
      const matchedFiles = args.files.filter(f => [...r.flow.entryFiles, ...r.flow.dependencies].includes(f));
      if (matchedFiles.length) flows.set(r.flow.id, { flow: r.flow.id, matchedFiles: [...new Set([...(flows.get(r.flow.id)?.matchedFiles ?? []), ...matchedFiles])] });
    }
    const result = page([...flows.values()], args);
    return { project: args.project, revision: args.revision, scope: 'recorded-dependencies-only', flows: result.items, total: result.total, nextOffset: result.nextOffset };
  }
  if (name === 'compare_flow') {
    const before = choose(records, { ...args, revision: args.before, run: args.beforeRun });
    const after = choose(records, { ...args, revision: args.after, run: args.afterRun });
    const result = { before: evidence(before), after: evidence(after), comparison: 'contract-and-status-only' };
    if (before.status === 'found' && after.status === 'found') {
      const a = before.records[0].declaredFlow === undefined ? before.records[0].flow : before.records[0].declaredFlow;
      const b = after.records[0].declaredFlow === undefined ? after.records[0].flow : after.records[0].declaredFlow;
      const changed = (xs, ys) => xs.filter(x => ys.some(y => y.id === x.id && JSON.stringify(x) !== JSON.stringify(y))).map(x => x.id);
      const absent = (xs, ys) => xs.filter(x => !ys.some(y => y.id === x.id)).map(x => x.id);
      result.contract = { changed: fingerprint(a) !== fingerprint(b), flowRemoved: !!a && !b, flowAdded: !a && !!b,
        removedStates: absent(a?.states ?? [], b?.states ?? []), addedStates: absent(b?.states ?? [], a?.states ?? []),
        changedStates: changed(a?.states ?? [], b?.states ?? []), removedTransitions: absent(a?.transitions ?? [], b?.transitions ?? []), addedTransitions: absent(b?.transitions ?? [], a?.transitions ?? []), changedTransitions: changed(a?.transitions ?? [], b?.transitions ?? []) };
      result.environmentComparable = [...before.records, ...after.records].some(r => !r.environment) ? null :
        before.records.length === after.records.length && before.records.every(r => after.records.some(s =>
          JSON.stringify(r.viewport) === JSON.stringify(s.viewport) && JSON.stringify(r.environment) === JSON.stringify(s.environment) && r.flow.fixture === s.flow.fixture && r.flow.profile === s.flow.profile));
    }
    return result;
  }
  const selected = choose(records, args);
  if (selected.status !== 'found') return selected;
  if (name === 'get_flow') return { ...evidence(selected), map: selected.records[0].declaredFlow === undefined ? selected.records[0].flow : selected.records[0].declaredFlow, executedContract: selected.records[0].flow };
  if (name === 'get_coverage_gaps') {
    const result = evidence(selected);
    return { ...result, runs: result.runs.map(r => ({ ...r, states: r.states.filter(s => s.status !== 'verified'), transitions: r.transitions.filter(e => e.status !== 'verified') })) };
  }
  if (name === 'trace_journey') {
    const flow = selected.records[0].flow, from = args.from ?? flow.initial;
    if (![from, args.to].every(s => flow.states.some(state => state.id === s))) return { status: 'unknown_state' };
    const paths = new Map([[from, []]]);
    for (const state of paths.keys()) for (const edge of flow.transitions.filter(e => e.from === state))
      if (!paths.has(edge.to)) paths.set(edge.to, [...paths.get(state), edge.id]);
    return paths.has(args.to) ? { status: 'found', evidence: 'declared', revision: selected.revision, from, to: args.to, transitions: paths.get(args.to) } : { status: 'no_path', from, to: args.to };
  }
  return evidence(selected);
}
