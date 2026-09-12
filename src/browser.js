import { randomUUID } from 'node:crypto';
import { flowSchema, id, revision, transitionPaths, viewports } from './schema.js';
import { hash, validatePng } from './store.js';

export function localOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Validation requires a loopback HTTP origin for a local test application');
  return url.origin;
}
function locate(page, spec) { return spec.role === 'text' ? page.getByText(spec.name, { exact: spec.exact !== false }) : page.getByRole(spec.role, { name: spec.name, exact: spec.exact !== false }); }
async function assertState(page, state) {
  for (const check of state.assertions) {
    const element = locate(page, check.locator);
    if (check.kind === 'visible' || check.kind === 'hidden') await element.waitFor({ state: check.kind, timeout: 2000 });
    else {
      const end = Date.now() + 2000;
      while (true) {
        const value = check.kind === 'count' ? await element.count() : await element.getAttribute(check.name, { timeout: 2000 });
        if (value === check.value) break;
        if (Date.now() >= end) throw new Error('Assertion failed');
        await page.waitForTimeout(50);
      }
    }
  }
}
export async function validateFlow(store, { project, revision: sha, flow: input, origin: inputOrigin, viewport: viewportName = 'desktop', channel, run = randomUUID(), timeoutMs = 90000 }) {
  const flow = flowSchema.parse(input), origin = localOrigin(inputOrigin);
  id.parse(project); revision.parse(sha);
  if (!viewports[viewportName] || (channel && !['chrome', 'msedge'].includes(channel))) throw new Error('Unsupported browser channel or viewport');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw new Error('Invalid validation timeout');
  const { chromium } = await import('playwright');
  const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'LANG'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  const browser = await chromium.launch({ headless: true, channel, env, timeout: 15000 });
  const observedAt = new Date().toISOString(), observations = [], images = new Map();
  const environment = { browserVersion: browser.version(), locale: 'en-US', timezone: 'UTC', fixedTime: '2026-01-01T12:00:00Z' };
  let expired = false;
  const timer = setTimeout(() => { expired = true; void browser.close().catch(() => {}); }, timeoutMs);
  try {
    for (const edgePath of transitionPaths(flow)) {
      if (expired) break;
      let context, target = flow.initial, transition;
      try {
        context = await browser.newContext({ viewport: viewports[viewportName], locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block', deviceScaleFactor: 1 });
        await context.route('**/*', route => {
          const request = route.request(), url = new URL(request.url());
          if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) return route.abort();
          if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
          return route.continue();
        });
        await context.routeWebSocket('**/*', socket => socket.close());
        const page = await context.newPage();
        page.setDefaultTimeout(3000);
        await page.clock.setFixedTime(new Date('2026-01-01T12:00:00Z'));
        let runtimeError = false;
        page.on('pageerror', () => { runtimeError = true; });
        async function observe(stateId) {
          await assertState(page, flow.states.find(s => s.id === stateId));
          if (runtimeError) throw new Error('Runtime error');
          const bytes = await page.screenshot({ animations: 'disabled', caret: 'hide', timeout: 3000 });
          validatePng(bytes);
          const image = hash(bytes); images.set(image, bytes);
          observations.push({ state: stateId, status: 'verified', image });
        }
        const response = await page.goto(origin + flow.route, { waitUntil: 'load', timeout: 10000 });
        if (!response?.ok()) throw new Error('Route unavailable');
        await observe(flow.initial);
        for (const edgeId of edgePath) {
          const edge = flow.transitions.find(e => e.id === edgeId);
          transition = edge.id; target = edge.to;
          const element = locate(page, edge.action.locator);
          if (edge.action.kind === 'click') await element.click(); else await element.fill(edge.action.value);
          await observe(target);
          observations.push({ state: target, transition, status: 'verified' });
        }
      } catch {
        observations.push({ state: target, ...(transition ? { transition } : {}), status: 'failed', reason: expired ? 'validation-timeout' : 'action-or-state-not-confirmed' });
      } finally { await context?.close().catch(() => {}); }
    }
  } finally { clearTimeout(timer); await browser.close(); }
  return store.put({ schema: 'ui-journey-snapshot/v1', project, revision: sha, run, observedAt,
    source: { kind: 'browser', provenance: 'caller-supplied' }, viewport: viewports[viewportName], environment, flow, observations }, images);
}
