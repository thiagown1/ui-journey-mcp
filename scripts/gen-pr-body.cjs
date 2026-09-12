const fs = require('node:fs');
function arg(name) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : ''; }
let body = fs.readFileSync('.github/PULL_REQUEST_TEMPLATE/change.md', 'utf8');
body = body.replace('Describe the observable behavior and why it changes.', arg('summary') || 'Describe the observable behavior and why it changes.');
body = body.replace('List executed commands and results. Do not mark planned checks as passed.', arg('tested') || 'No validation reported.');
body = `<!-- implementation:start -->\n${body}\n<!-- implementation:end -->`;
if (arg('current-body-file')) {
  const current = fs.readFileSync(arg('current-body-file'), 'utf8');
  if ((current.match(/<!-- implementation:start -->/g) || []).length !== 1 || (current.match(/<!-- implementation:end -->/g) || []).length !== 1) throw new Error('Expected one managed implementation block');
  body = current.replace(/<!-- implementation:start -->[\s\S]*?<!-- implementation:end -->/, body);
}
if (arg('output')) fs.writeFileSync(arg('output'), body); else process.stdout.write(body);
