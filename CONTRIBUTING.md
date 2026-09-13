# Contributing

Write code, comments, documentation, examples, issues and pull requests in English.
Use English headings from the repository's pull request template.

Keep the model independent of applications and clients. Adapters must distinguish
declarations from observations and make source/version provenance explicit.
Never commit production data or real customer screenshots.

Run `npm test`, `npm run check` and relevant browser integration. Add regression
tests for evidence/privilege changes and document schema changes.

Use `.github/PULL_REQUEST_TEMPLATE/change.md`. Generate with
`node scripts/gen-pr-body.cjs --summary "..." --tested "..." --output body.md`,
validate with `node scripts/validate-pr-body.cjs --body-file body.md`, then use
`gh pr create --body-file body.md`. Include `--current-body-file` for an open PR
to preserve notes outside the managed block.

MIT contributions only. Future work includes authenticated synthetic fixtures,
additional discovery adapters, remote persistence and opt-in browser execution via MCP.
Keep the default MCP server read-only.
