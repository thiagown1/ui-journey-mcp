const fs = require('node:fs');
const i = process.argv.indexOf('--body-file');
const body = fs.readFileSync(process.argv[i + 1], 'utf8');
for (const heading of ['## Acceptance Criteria', '## Cenários cobertos', '## Testes', '## Riscos e Rollback'])
  if (!body.includes(heading)) throw new Error(`Missing ${heading}`);
if (!/## Testes[\s\S]*?(?:\[x\]|passed|passaram|Resultado: ✅)/.test(body)) throw new Error('Executed-test evidence required');
process.stdout.write('OK\n');
