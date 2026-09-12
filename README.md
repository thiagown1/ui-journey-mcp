# UI Journey MCP

**Ask an agent what a UI flow does, which version was tested, and show the evidence.**

Independent MIT-licensed MCP server and CLI for mapped UI flows and immutable
browser evidence. No dependency on Codebase Memory, GitHub or any application.
Runs locally; no model API, hosted account or telemetry.

Status: **experimental v0.1**. Read-only MCP queries work with saved evidence;
the CLI can validate anonymous flows against a local test application. Automatic
route discovery, authenticated fixtures and remote MCP hosting are not included.

## Example queries

```text
get_flow_evidence(project="shop", flow="checkout", revision="<40-character SHA>")
compare_flow(project="shop", flow="checkout", before="<SHA>", after="<SHA>")
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

## Try a local flow

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
| `list_flows` | Mapped flows and available revisions; paginated |
| `get_flow` | Declared map, executed contract and evidence summary |
| `get_flow_evidence` | Outcomes, state screenshots, run, version and freshness |
| `compare_flow` | Added/removed/changed states and actions, evidence from both versions |
| `trace_journey` | Shortest declared path between states within one flow |
| `get_ui_impact` | Flows affected through recorded entry files/dependencies |
| `get_coverage_gaps` | Failed or unverified states/transitions in a mapped flow |
| `get_change_evidence` | Stored runs carrying a particular PR number |
| `get_evidence_image` | A referenced PNG as inline MCP image content |

CLI queries use the same names and JSON arguments. All nine MCP tools are read-only.
Browser execution is an explicit CLI operation, not an MCP tool in v0.1.

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
- Coverage and impact include **mapped flows and recorded dependencies only**.
  This server does not yet crawl an application or discover routes itself.

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
