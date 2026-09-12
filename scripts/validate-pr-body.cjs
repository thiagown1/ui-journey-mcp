const fs = require('node:fs');
const i = process.argv.indexOf('--body-file');
const body = fs.readFileSync(process.argv[i + 1], 'utf8');
for (const heading of ['## Acceptance Criteria', '## Covered Scenarios', '## Tests', '## Risks and Rollback'])
  if (!body.includes(heading)) throw new Error(`Missing ${heading}`);
const tests = body.match(/^## Tests\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] || '';
if (!/\[x\]|\bpassed\b/i.test(tests)) throw new Error('Executed-test evidence required in the Tests section');
process.stdout.write('OK\n');
