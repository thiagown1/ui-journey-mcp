import { z } from 'zod';

export const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const revision = z.string().regex(/^[a-f0-9]{40}$/);
export const digest = z.string().regex(/^[a-f0-9]{64}$/);
const label = z.string().min(1).max(300);
export const relativePath = z.string().min(1).max(500).refine(value =>
  !/^[/.]|[\\:\x00-\x1f]/.test(value) && !value.split('/').some(part => !part || part === '..' || part === '.'), 'Expected a relative repository path');
const locator = z.object({ role: z.enum(['button', 'textbox', 'heading', 'tab', 'region', 'link', 'text']), name: label, exact: z.boolean().optional() });
const assertion = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('visible'), locator }),
  z.object({ kind: z.literal('hidden'), locator }),
  z.object({ kind: z.literal('count'), locator, value: z.number().int().min(0).max(1000) }),
  z.object({ kind: z.literal('attribute'), locator, name: z.string().regex(/^aria-[a-z-]+$/), value: z.string().max(300) }),
]);
const action = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), locator }),
  z.object({ kind: z.literal('fill'), locator, value: z.string().max(300) }),
]);
export const flowSchema = z.object({
  id, title: label,
  route: z.string().regex(/^\/(?!\/)[a-zA-Z0-9/_-]*$/),
  profile: z.literal('anonymous'), effects: z.literal('read-only'), fixture: label,
  entryFiles: z.array(relativePath).max(100).default([]),
  dependencies: z.array(relativePath).max(5000).default([]),
  initial: id,
  states: z.array(z.object({ id, assertions: z.array(assertion).min(1).max(10) })).min(1).max(20),
  transitions: z.array(z.object({ id, from: id, to: id, action })).max(40),
}).superRefine((flow, ctx) => {
  const states = new Set(flow.states.map(s => s.id));
  const edges = new Set(flow.transitions.map(e => e.id));
  const invalid = message => ctx.addIssue({ code: 'custom', message });
  if (states.size !== flow.states.length || edges.size !== flow.transitions.length) invalid('Duplicate state or transition');
  if (!states.has(flow.initial)) invalid('Unknown initial state');
  if (flow.transitions.some(e => !states.has(e.from) || !states.has(e.to))) invalid('Unknown transition endpoint');
  const reachable = new Set([flow.initial]);
  for (let i = 0; i < states.size; i++) for (const edge of flow.transitions) if (reachable.has(edge.from)) reachable.add(edge.to);
  if ([...states].some(s => !reachable.has(s))) invalid('Unreachable state');
});
export const observationSchema = z.object({
  state: id, transition: id.optional(), status: z.enum(['verified', 'failed', 'unavailable']),
  image: digest.optional(), reason: z.string().max(200).optional(),
});
export const snapshotSchema = z.object({
  schema: z.literal('ui-journey-snapshot/v1'), project: id, revision,
  run: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/),
  observedAt: z.iso.datetime().nullable(),
  source: z.object({ kind: z.enum(['mapped', 'browser', 'imported']), pr: z.number().int().positive().optional(),
    side: z.enum(['before', 'after']).optional(), contractOrigin: z.enum(['base', 'head', 'declared']).optional(), provenance: z.literal('caller-supplied') }),
  viewport: z.object({ name: id, width: z.number().int().min(100).max(1600), height: z.number().int().min(100).max(1200) }),
  environment: z.object({ browserVersion: label, locale: label, timezone: label, fixedTime: z.iso.datetime() }).optional(),
  flow: flowSchema,
  declaredFlow: flowSchema.nullable().optional(),
  observations: z.array(observationSchema).max(2000),
}).superRefine((snapshot, ctx) => {
  const states = new Set(snapshot.flow.states.map(s => s.id));
  if (snapshot.declaredFlow && snapshot.declaredFlow.id !== snapshot.flow.id)
    ctx.addIssue({ code: 'custom', message: 'Declared and executed flow IDs differ' });
  const edges = new Map(snapshot.flow.transitions.map(e => [e.id, e.to]));
  for (const obs of snapshot.observations) {
    if (!states.has(obs.state) || (obs.transition && edges.get(obs.transition) !== obs.state))
      ctx.addIssue({ code: 'custom', message: 'Observation does not match the executed flow' });
  }
  if (snapshot.source.kind === 'mapped' && snapshot.observations.length)
    ctx.addIssue({ code: 'custom', message: 'A map alone cannot claim browser observations' });
});

export function transitionPaths(flow) {
  const paths = new Map([[flow.initial, []]]);
  for (const state of paths.keys()) for (const edge of flow.transitions.filter(e => e.from === state))
    if (!paths.has(edge.to)) paths.set(edge.to, [...paths.get(state), edge.id]);
  return flow.transitions.length ? flow.transitions.map(e => [...paths.get(e.from), e.id]) : [[]];
}

export const viewports = { desktop: { name: 'desktop', width: 1440, height: 1000 }, mobile: { name: 'mobile', width: 390, height: 844 } };
