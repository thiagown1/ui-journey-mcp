# CI and pull request integration

UI Journey provides a portable indexer and evidence store. Each consuming project
owns its application setup, test fixtures, CI triggers and GitHub permissions.
Do not connect CI runners to a developer's local MCP process.

## Configure the source adapters

Commit `.ui-journey.json` at the root of a Git checkout:

```json
{
  "schema": "ui-journey-project/v1",
  "project": "example",
  "webRoots": ["web"],
  "flutterRoots": [{ "root": "mobile", "package": "example", "rootModule": "AppModule" }]
}
```

Use only the roots your application has. Web roots support Next App Router
`app/` and `src/app/`, TypeScript/JavaScript imports, `@/` aliases rooted at the
configured web root, literal links, common router methods and interaction props.
Flutter roots support Modular `r.child`, `r.module`, `ChildRoute`, `ModuleRoute`,
`Modular.initialRoute`, page/screen widget declarations and common named
navigation methods. Nested module prefixes are composed. Dart extraction is
lexical and convention-based, not compiler/type analysis. Unmounted modules,
unresolved imports, dynamic destinations and ambiguous target classes remain
explicit; custom routing wrappers and unsupported frameworks need adapters.
Dependency-based edges are potential interactions, not proven reachability.

## Local synchronization

```sh
node /path/to/ui-journey-mcp/bin/ui-journey.js serve --repo /path/to/checkout --store /private/evidence
```

With no `--repo`, `serve` auto-detects `.ui-journey.json` in its working directory.
Configure the client's working directory or pass `--repo` explicitly. One server
instance indexes one checkout; separate worktrees must not share an assumed HEAD.
The server refreshes in the background (default 5 seconds) and refreshes before
navigation queries. Git-tracked and nonignored untracked source files are included.
Content hashes, not mtime alone, invalidate parsed files. Linking is recomputed
against the complete file inventory, so deleted files/imports and newly resolved
imports are reflected. Persisted parse caches are scoped by checkout path and
parser version. They are derived data, separate from immutable browser evidence.

Each query reports the commit, source content hash, dirty flag and index time.
The input is checked again after parsing; repeated concurrent changes cause an
explicit error instead of a stale success. Freshness is a point-in-time statement,
not a guarantee against edits after a response. A stopped MCP process does not
watch files; the next startup/query reconciles them.

The indexer reads bounded source files and Git metadata; it never runs application
code, imports the application's modules or starts a browser. Keep caches private.
Limits: 20,000 source/config files, 2 MiB per file, 64 MiB source total. Symlinks in
working-tree input are rejected. Same-user filesystem tampering is outside the
threat model. Unsupported patterns mean coverage is never claimed exhaustive.

## Required CI stages

1. Pin the reviewed indexer commit and lock dependencies. Use Node.js 22+.
2. Run on PR open, synchronize and reopen, and on default-branch pushes. Include
   every configured source root, configuration and collector file in path filters.
3. Read the exact base and head Git revisions with the same indexer version:

```sh
node /path/to/ui-journey.js index --repo . --revision "$BASE_SHA" --output artifacts/navigation-before.json
node /path/to/ui-journey.js index --repo . --revision "$HEAD_SHA" --output artifacts/navigation-after.json
node /path/to/ui-journey.js compare-index --before artifacts/navigation-before.json --after artifacts/navigation-after.json --output artifacts/navigation-impact.json
```

The current checkout configuration is used only if that revision has no config;
the graph labels this `configSource: worktree-fallback`. This bootstraps the first
integration PR without pretending the configuration existed in its base.

4. Select executable tests using the union of base/head dependency closures.
   Run the application separately at each exact revision with deterministic test
   data. Keep declared maps separate from executed observations. Report affected
   routes without tests as unverified. Screenshots cannot prove exported file
   contents, authorization or other nonvisual behavior; add appropriate assertions.
5. Import the collector's before/after snapshots with the CLI. Persist the store
   or exported artifacts explicitly; an ephemeral CI directory is not durable.
6. Publish through trusted default-branch code in a separate job/workflow with
   narrowly scoped permissions. Do not run untrusted PR code with write tokens.
   Revalidate repository, run/attempt and current PR base/head before each write.
7. Store validated PNGs in a dedicated evidence branch of the consuming repository
   (or another explicitly selected destination preserving its visibility). Use
   immutable URLs in a managed PR-description block, with before/after images,
   commit identities, run link, failures and missing coverage. Preserve author text.
8. Verify the final PR body contains the managed block and every published image
   reference. A stale run must not overwrite newer evidence. Configure required
   status checks in the consuming repository when publication must block merging.

The MCP recommends these stages in its server instructions and status response.
It does not edit GitHub or change branch protection. Screenshots remain historical
until a collector executes the changed code; updating the static map never marks
old evidence as newly verified.

## Optional UI audit stage

After importing evidence, call `audit --args JSON --store PATH --repo CHECKOUT`
for each affected mapped flow and exact head SHA. Supply application-owned entry
routes, terminal states and design rules/reference. Preserve the JSON report as
an artifact; inspect statuses and findings explicitly rather than treating CLI
exit zero or `completed` as approval. Visual review requires the calling agent
to retrieve and inspect the referenced images. See [UI audits](ui-audit.md).

Only affected-flow evidence belongs in the product-change PR block. Harness
self-tests must keep their demo screenshots in test artifacts. A flow without
applicable execution is a coverage gap, never a reason to substitute an unrelated
pilot screen. The consuming repository owns this selection and publication
policy; adding the MCP tool alone does not modify its workflows.
