# UI audits

`audit_ui` combines a declared flow, exact-commit source navigation and stored
execution evidence. It identifies missing paths in the available map, return-path
questions, caller-defined step-budget overruns and recorded failures. It prepares
a design review packet for the calling agent. It never executes a browser, calls
a model API, edits application source or publishes a PR.

## Start with the affected flow

1. Inspect `get_index_status` and `get_navigation_impact` for the task's checkout.
   For CI, compare exact base/head indexes and their dependency closures.
2. Select an affected mapped flow. Collect and import evidence from the exact
   build when runtime or visual validation is needed.
3. Call `audit_ui` with that flow and the full commit SHA. Supply real entry
   routes, intended terminal states and the design rules/reference for the app.
4. Read the findings and retrieve the returned images using `get_evidence_image`.
   The calling agent evaluates product intent and visual consistency, citing
   specific states, images and rules. Missing evidence remains a gap.

Example MCP arguments (replace the illustrative SHA with your actual commit):

```json
{
  "project": "shop",
  "flow": "member-export",
  "revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "checks": ["navigation", "flow", "design"],
  "files": ["web/app/members/page.tsx"],
  "entryRoutes": ["/dashboard"],
  "terminalStates": ["download-ready"],
  "maxSteps": 4,
  "designRules": [
    "Use the shared primary button for the main page action.",
    "Use the shared table toolbar spacing and typography.",
    "Show loading, success and error feedback consistently."
  ]
}
```

These rules are application-owned input, not standards hard-coded in the public
MCP. Keep a versioned application policy and let the agent or CI supply it. The
MCP does not automatically load a design-system file or infer product intent.

The CLI and exported API use the same input and result schema:

```sh
node bin/ui-journey.js audit --store /private/evidence --repo /path/to/app --args '{"project":"shop","flow":"member-export","revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","checks":["navigation","flow"],"entryRoutes":["/dashboard"],"terminalStates":["download-ready"]}'
```

```js
import { EvidenceStore, NavigationIndex, auditUI } from 'ui-journey-mcp';

const result = await auditUI(new EvidenceStore('/private/evidence'), {
  project: 'shop', flow: 'member-export', revision: headSha,
  entryRoutes: ['/dashboard'], terminalStates: ['download-ready'],
}, { index: new NavigationIndex({ repo: '/path/to/app' }) });
```

## Arguments and scope

| Argument | Meaning |
| --- | --- |
| `project`, `flow`, `revision` | Required project ID, mapped flow ID and exact 40-character lowercase commit SHA |
| `run` | Optional stored run; resolves unknown/tied observation times |
| `checks` | One or more of `navigation`, `flow`, `design`; default all three |
| `files` | Optional 1–100 repository-relative changed files; restricts this flow to recorded dependencies |
| `entryRoutes` | Optional 1–20 known web entry routes; there is no assumed home or authenticated landing page |
| `terminalStates` | Up to 20 declared state IDs intentionally ending the flow; default none |
| `maxSteps` | Optional 1–40 transition budget; no universal UX threshold is assumed |
| `designRules` | Up to 20 application-owned criteria, each at most 500 characters |
| `designReference` | Optional `{ "flow": "reference-id", "revision": "<SHA>", "run": "optional-run" }` within the same project |

Without `files`, the caller explicitly requests that one flow, independent of a
PR. With `files`, an empty dependency intersection returns `not_affected` without
images. This means **no recorded dependency match**, not that the entire UI is
unchanged. Missing/removed dependencies and global configuration changes require
base/head source-impact analysis. Tooling changes never trigger a pilot-flow
fallback. A removed declaration returns `flow_removed`; it cannot become a fresh
validation of the old executed contract.

The source map and executed flow are different inventories. An indexed route
without a stored flow returns `not_found`, not a synthetic successful audit.
For an explicit application-wide review, paginate both inventories, audit mapped
flows individually and report routes without executable flows as coverage gaps.
There is no exhaustive full-app or automatic flow-generation claim.

## What each layer verifies

**Navigation:** the configured index reads the requested Git revision. Audit
rejects a mismatching/dirty index, wrong project or configuration borrowed from
the current checkout. Each explicit entry route must resolve uniquely. The flow
route must match exactly one web route and its recorded entry file. Resolved
edges yield shortest inferred paths; unresolved destinations on those paths and
at the entry/flow are reported separately. Unrelated branches are not audited.

A missing source path is a coverage/review gap, not a confirmed broken link.
Guards, permissions, dynamic parameters, deep links and conditional components
need runtime scenarios. A `path_found` result never proves a user can navigate
it. Current cross-route auditing supports the web flow contract; Flutter source
discovery remains available through navigation tools, but native flow execution
and native audit evidence are not implemented.

**Flow:** shortest declared paths, ability to return to the initial state and an
optional step budget. A missing return path asks whether completion, cancellation
or recovery was omitted from the map. An explicitly terminal state suppresses
that question. Cycles are allowed and traversal terminates. The snapshot schema
already rejects unreachable declared states; audit does not independently prove
that the app implements that contract. Product usefulness and simplification are
review tasks, not deterministic conclusions about usability.

**Execution:** stored outcomes and coverage, with failure precedence. If the
declared map differs from the executed contract, the result includes
`contract_not_executed`. Recorded failures remain visible. Commit, fixture and
run identities are caller-supplied; the collector must attest the serving build.

**Design:** current image references plus supplied criteria and an optional
reference flow/revision. A reference can represent the previous implementation
or a comparable screen. Referenced PNGs are checked for store availability and
content integrity; failed states never supply a previous successful screenshot.
Partial evidence exposes each state's status and available images.

Run pairs require known, matching browser version, locale, timezone, fixed time,
viewport, fixture and profile. Incompatible or missing metadata prevents pairing.
Unpaired records are listed explicitly. Matching metadata is only a prerequisite:
the agent must still check equivalent purpose/state and theme or other context
not represented in the schema. Different legitimate screen purposes must not be
flagged merely for looking different. No pixels or design tokens are evaluated
by this tool; `verdict` always remains `not_evaluated`.

## Interpret the result

The top-level schema is `ui-audit/v1`. `completed` means analysis returned,
**not** that the UI passed. `exhaustive` is always false.

Findings have `code`, `kind` and `evidence`. Kinds distinguish recorded `failure`,
coverage `gap`, intent-dependent `review` and possible `suggestion`. Layer
statuses remain explicit, including `not_requested`, navigation `unavailable`
or `entry_routes_required`, and design `needs_evidence`, `needs_design_standard`,
`reference_unavailable`, `incomparable_context` or `ready_for_agent_review`.
The last status means the agent can inspect the packet; it is not visual approval.

Selection errors return `not_found` or `selection_required` and never substitute
another revision. Conflicting declared maps across viewports also require
reconciliation. The normal exact-revision run-selection rules still apply.

Reports include at most 10 evidence records per side, two PNG references per
state and 50 navigation path/detail items per entry/list. Truncation is explicit;
request remaining evidence with existing flow/image tools or select a specific
run. Execution summary totals include all selected records.

## CI and PR policy

Run audit after importing exact-revision evidence. Persist its JSON alongside
the collector artifacts. The CLI exits successfully when it returns a structured
result, including gaps and recorded failures; **do not use exit code alone as a
merge gate**. The consuming project decides which finding/status combinations
block, require review or are informative. Start with objective runtime failures
and required evidence gaps; keep subjective design/optimization suggestions
advisory until the project defines a reviewed policy.

Publish only affected-flow findings and actual before/after images in the managed
PR block, with exact commit/run identities and explicit gaps. Keep harness demo
screenshots in tooling-test artifacts rather than treating them as product-change
evidence. This package documents the integration; GitHub publishing remains in
the consuming repository's trusted workflow. See [CI integration](ci-integration.md).

After installing a version containing this tool, restart/reconnect the MCP client
and confirm `audit_ui` appears in tool discovery. Existing sessions do not acquire
a new tool merely because a PR was opened or files changed on disk.
