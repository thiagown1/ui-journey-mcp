# UI Journey MCP

**Ask an agent what a UI flow does, which version was tested, and show the evidence.**

Independent MIT-licensed MCP server and CLI for mapped UI flows and immutable
browser evidence. No dependency on Codebase Memory, GitHub or any application.
Runs locally; no model API, hosted account or telemetry.

Status: **experimental v0.3**. Incremental source indexing discovers Next App
Router and Flutter Modular navigation. MCP queries refresh the configured checkout
and separately retrieve saved execution evidence. The CLI can validate anonymous
flows against a local test application. Authenticated fixtures and remote MCP
hosting are not included.

## Example queries

```text
get_flow_evidence(project="shop", flow="checkout", revision="<40-character SHA>")
compare_flow(project="shop", flow="checkout", before="<SHA>", after="<SHA>")
audit_ui(project="shop", flow="checkout", revision="<SHA>", entryRoutes=["/shop"], terminalStates=["complete"])
get_evidence_image(project="shop", digest="<image hash from the result>")
```

Flows are the primary entity. PR numbers are optional metadata. Query a mapped
flow without a PR, retrieve an exact historical run, or compare revisions.
`get_evidence_image` returns a PNG inline; resource URIs are also available.

## Install from source

Requires Node.js 22+ and npm. This package has not been published to npm.

```sh
git clone https://github.com/thiagown1/ui-journey-mcp.git
cd ui-journey-mcp
npm ci
node bin/ui-journey.js help
```

Configure your MCP client with absolute paths. On Windows, use forward slashes
or escape backslashes in JSON. Restart/reconnect the client after adding a server.

```json
{
  "mcpServers": {
    "ui-journey": {
      "command": "node",
      "args": ["/absolute/path/ui-journey-mcp/bin/ui-journey.js", "serve", "--store", "/private/path/ui-evidence"]
    }
  }
}
```

The default store is `~/.ui-journey/store`. Use a persistent directory or mounted
volume for long-term storage. Records never expire automatically; back up the store.

### Codex setup

Register a stable checkout with absolute paths, outside a temporary worktree:

```sh
codex mcp add ui-journey-mcp -- /absolute/path/to/node /absolute/path/ui-journey-mcp/bin/ui-journey.js serve --store /private/path/ui-evidence
codex mcp get ui-journey-mcp --json
```

This adds a server to the host's global Codex configuration, shared by the local
desktop app, CLI and IDE extension. Restart/reconnect your client and inspect
`/mcp` to confirm the connection. An enabled configuration entry alone does not
prove that an existing session loaded the server. See the official
[Codex MCP setup guide](https://developers.openai.com/codex/mcp).

Once connected, ask for `list_flows` with your project ID, then
`get_flow_evidence` with a mapped flow and exact revision. Retrieve a returned
image digest with `get_evidence_image` to verify image delivery as well.

Availability does not mean invocation on every message. Agents select tools for
the task; this server does not intercept other calls or automatically collect
new screenshots. Codebase Memory can coexist as a separate server, but is not a
dependency. To encourage consistent use, add this guidance to the consuming
project's `AGENTS.md`, replacing the project ID:

```markdown
For UI changes, consult UI Journey MCP using project="your-project":
- Use get_ui_impact for changed files and inspect relevant mapped flows.
- Use get_flow_evidence or compare_flow with exact commit revisions.
- Retrieve screenshots with get_evidence_image when reviewing visual evidence.
- Use audit_ui on affected flows at the exact revision. Supply known entry routes,
  intended terminal states and the project's design rules or reference flow.
- Treat flow/design suggestions as review tasks, not automatic approval.
- Report missing, failed, stale or unverified evidence explicitly. Never treat
  mapping alone as a successful browser validation.
- If the server is unavailable, state that limitation; do not invent evidence.
```

These instructions guide tool selection; enforce required browser validation in
CI if it must be a merge requirement. Import new collector output into the
configured store to keep evidence up to date.

## Try a local flow

To keep a source navigation map synchronized, configure `.ui-journey.json` in
your application and pass `--repo /path/to/checkout` to `serve`. Use
`get_index_status`, `get_navigation_map` and `get_navigation_impact` for inferred
routes/actions. Existing evidence queries remain about executed/declared flows.
See [source synchronization and CI integration](docs/ci-integration.md) for
adapters, exact-revision comparison and before/after images in PR descriptions.

```sh
npx playwright install chromium
node examples/serve.js
```

The demo prints an unused loopback URL. Keep it running and substitute that URL
and the full SHA of the checkout serving the page in another terminal:

```sh
node bin/ui-journey.js validate --project demo --flow-file examples/help-flow.json --origin http://127.0.0.1:PORT --revision FULL_COMMIT_SHA --store .ui-journey
node bin/ui-journey.js query get_flow_evidence --args '{"project":"demo","flow":"help"}' --store .ui-journey
```

Use `--channel chrome` or `--channel msedge` for an installed browser.
`--viewport mobile` captures 390 × 844; desktop is 1440 × 1000. `validate` saves
failed evidence and exits nonzero on failed/incomplete validation. It does not
start the application: use your project's test-server setup.

The [flow file](examples/help-flow.json) describes a static route, accessible
locators, observable states, click/fill transitions and fixture identity. Each
edge is reached from a fresh browser context using a shortest path. States without
outgoing transitions are captured too. Test fixtures must be deterministic.

## Tools

| Tool | Result |
| --- | --- |
| `get_index_status` | Refresh source index; report commit, content hash, dirty state and limits |
| `get_navigation_map` | Refresh and paginate inferred routes, actions, edges or diagnostics |
| `get_navigation_impact` | Refresh and find potentially affected routes in the checkout |
| `audit_ui` | Exact-revision entry/return paths, step budgets, execution gaps and a design review packet |
| `list_flows` | Mapped flows and available revisions; paginated |
| `get_flow` | Declared map, executed contract and evidence summary |
| `get_flow_evidence` | Outcomes, state screenshots, run, version and freshness |
| `compare_flow` | Added/removed/changed states and actions, evidence from both versions |
| `trace_journey` | Shortest declared path between states within one flow |
| `get_ui_impact` | Flows affected through recorded entry files/dependencies |
| `get_coverage_gaps` | Failed or unverified states/transitions in a mapped flow |
| `get_change_evidence` | Stored runs carrying a particular PR number |
| `get_evidence_image` | A referenced PNG as inline MCP image content |

Evidence CLI queries use the same names and JSON arguments. Source indexing uses
the `index` and `compare-index` CLI commands; audits use `audit --args JSON`.
All thirteen MCP tools leave application
source unchanged; navigation queries update a derived private index cache.
Browser execution is an explicit CLI operation, not an MCP tool.

See the [UI audit guide](docs/ui-audit.md) for arguments, output states, design
reference selection, CI policy and examples. Audit results distinguish structural
facts, inferred gaps, recorded failures and suggestions. Visual review belongs to
the calling agent: the server supplies verified image references and context,
never an aesthetic pass/fail verdict or a claim that all application flows work.

### Selection and provenance

- Mapping is `unverified` until observations cover every declared state and edge.
- Exact revision requests never fall back to another revision. With multiple
  revisions, the caller must select one; SHA ordering is not chronological.
- Within a revision, the latest known observation time wins, including failures.
  Unknown/tied times require a `run`; conflicting records are flagged.
- Without `currentRevision`, freshness is `unknown`. A match means matching the
  caller's requested revision, not a live production check.
- Revision, PR, fixture and source identities are **caller-supplied**. The importer
  does not authenticate a CI run or prove the URL serves that commit. Your collector
  must check out the exact revision and provide truthful metadata. Local CLI
  validation likewise does not attest the identity of the running build.
- The preserved executed base contract can differ from the new declared map.
  Both are stored: deleting an action cannot erase a failed attempt to execute it.
- Comparison is structural/status-based, not an aesthetic or pixel correctness
  verdict. Missing environment metadata gives `environmentComparable: null`.
- Execution coverage includes **declared flows and recorded dependencies only**.
  The separate source index discovers supported routing conventions. It does not
  crawl the UI, prove runtime reachability or automatically create browser tests.

## Import CI evidence

Native records follow [the snapshot schema](src/schema.js), with PNGs named by SHA-256:

```sh
node bin/ui-journey.js import --file snapshot.json --images ./images --store /persistent/private/evidence
```

The adapter also accepts `ui-graph/v1`: `journeys`, `sha`, `observations` and optional
`executedContracts`. Extra AST inventory fields are ignored. Import both sides separately:

```sh
node bin/ui-journey.js import-graph --graph graph-after.json --images ./captures --project shop --run ci-123-after --pr 42 --side after --store /persistent/private/evidence
```

Supply `--observed-at` only with the actual execution time. Otherwise time remains
unknown, not the import time. Original PNG names must be simple `a-z0-9-` basenames.
Observations must match the graph SHA and executed flow. PNG bytes are copied into
the store, so expiration of a CI artifact does not delete imported evidence.
Repeating the same import is idempotent.

On ephemeral runners the directory disappears unless **you persist/export it**.
Use a private volume, authenticated transfer or an explicit evidence branch in
your integration. This project does not push data or edit PRs automatically.
Local MCP requires no GitHub token.

## Storage and privacy

```text
store/<project>/records/<sha256>.json
store/<project>/images/<sha256>.png
```

Records/images are immutable. Images are written before records with atomic
create-if-absent operations. Interrupted imports may leave unreferenced blobs;
existing records are never overwritten. Graph imports are atomic per record,
not across all flows/viewports. No automatic history deletion.

Limits: 20 states/40 transitions per flow, 1 MiB per PNG, 1600 × 1200 maximum
dimensions, 4 MiB per JSON, 10,000 records/64 MiB metadata per project. Lists default
to 20 and allow 50 results. Partition large stores. PNG signatures, chunk boundaries
and dimensions are checked, not fully decoded. Hashes detect corruption, not authorship.

Keep screenshots/data in a separate **private store**, never this public repository.
Use sanitized fixtures; images may contain secrets or personal data. The package
allowlist includes source and synthetic examples only.

The stdio server reads every project in its configured store. Project IDs provide
namespacing, **not tenant authorization**. Scope stores and filesystem access per
client. No remote HTTP server/authentication is included. Symlinked store directories,
nonregular files and traversal IDs are rejected; this is not a sandbox against a
concurrent attacker controlling the same filesystem.

CLI validation permits loopback HTTP, fresh contexts, same-origin GET/HEAD, no
service workers/WebSockets and fixture 404s for `/api/`. Browser processes receive
a narrow environment without host tokens. The page's JavaScript still runs: use
a local **test application** and sandbox untrusted code. GET can have server-side
effects. This is not a general OS/network sandbox. No production credentials,
authenticated flows, arbitrary JavaScript tools, model API or telemetry.

## Development

```sh
npm ci
npm test
npm run check
npx playwright install chromium
npm run test:browser
npm audit
npm pack --dry-run
```

Tests cover selection, stale/unknown evidence, removed contracts, corruption,
traversal, concurrency and a real MCP stdio client. Browser integration uses
synthetic pages for success, regression, mobile, blocked POST and MCP image delivery.
See [CONTRIBUTING.md](CONTRIBUTING.md).

Built on the official [MCP SDK](https://ts.sdk.modelcontextprotocol.io/) and
[Playwright](https://playwright.dev/docs/api/class-browsercontext).
