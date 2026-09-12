import path from 'node:path';
import fs from 'node:fs/promises';
import { z } from 'zod';
import { flowSchema, id, revision, viewports } from './schema.js';
import { readJson, readBounded, hash } from './store.js';

const graphSchema = z.object({
  schema: z.literal('ui-graph/v1'), sha: revision,
  journeys: z.array(flowSchema).max(200),
  executedContracts: z.array(z.object({ journey: flowSchema, origin: z.enum(['base', 'head']) })).max(200).default([]),
  observations: z.array(z.object({ journey: id, viewport: z.enum(['desktop', 'mobile']), state: id,
    transition: id.nullable().optional(), status: z.enum(['verified', 'failed', 'unavailable', 'not-applicable']),
    image: z.string().regex(/^[a-z0-9-]+\.png$/).optional(), reason: z.string().max(200).optional(),
    sha: revision, profile: z.literal('anonymous') })).max(10000).default([]),
});

export async function importGraph(store, { graph: file, images: imageDirectory, project, run, observedAt = null, pr, side }) {
  const graph = graphSchema.parse(await readJson(file));
  const flows = new Map(graph.journeys.map(flow => [flow.id, { journey: flow, origin: 'declared' }]));
  for (const contract of graph.executedContracts) flows.set(contract.journey.id, contract);
  if (graph.observations.some(obs => obs.sha !== graph.sha || !flows.has(obs.journey))) throw new Error('Observation revision or flow mismatch');
  if (new Set(graph.journeys.map(f => f.id)).size !== graph.journeys.length ||
      new Set(graph.executedContracts.map(c => c.journey.id)).size !== graph.executedContracts.length) throw new Error('Duplicate flow contract');
  if (imageDirectory) {
    const stat = await fs.lstat(imageDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Image directory must be a regular directory');
  }
  const prepared = [];
  for (const { journey: flow, origin } of flows.values()) for (const viewport of Object.values(viewports)) {
    const images = new Map(), observations = [];
    for (const obs of graph.observations.filter(o => o.journey === flow.id && o.viewport === viewport.name)) {
      let image;
      if (obs.image) {
        if (!imageDirectory) throw new Error('Image directory required for screenshot observations');
        const bytes = await readBounded(path.join(imageDirectory, obs.image), 1024 * 1024);
        image = hash(bytes); images.set(image, bytes);
      }
      observations.push({ state: obs.state, ...(obs.transition ? { transition: obs.transition } : {}),
        status: obs.status === 'not-applicable' ? 'unavailable' : obs.status, ...(image ? { image } : {}), ...(obs.reason ? { reason: obs.reason } : {}) });
    }
    prepared.push({ snapshot: { schema: 'ui-journey-snapshot/v1', project, revision: graph.sha, run, observedAt,
      source: { kind: observations.length ? 'imported' : 'mapped', provenance: 'caller-supplied', pr, side, contractOrigin: origin },
      viewport, flow, declaredFlow: graph.journeys.find(j => j.id === flow.id) ?? null, observations }, images });
  }
  const results = [];
  for (const item of prepared) results.push(await store.put(item.snapshot, item.images));
  return { imported: results.length, revision: graph.sha, records: results.map(r => r.recordId) };
}

export async function importSnapshot(store, file, imageDirectory) {
  const snapshot = await readJson(file), images = new Map();
  // Filenames are derived only from validated content hashes, never from metadata paths.
  const { snapshotSchema } = await import('./schema.js');
  const valid = snapshotSchema.parse(snapshot);
  for (const obs of valid.observations) if (obs.image && imageDirectory)
    images.set(obs.image, await readBounded(path.join(imageDirectory, `${obs.image}.png`), 1024 * 1024));
  const saved = await store.put(valid, images);
  return { imported: 1, records: [saved.recordId] };
}
