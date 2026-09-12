import http from 'node:http';
import fs from 'node:fs/promises';
const bytes = await fs.readFile(new URL('./site/index.html', import.meta.url));
const server = http.createServer((request, response) => {
  if (request.url !== '/' || request.method !== 'GET') { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(bytes);
});
// Port 0 lets the OS select an unused port rather than starting a duplicate server.
server.listen(0, '127.0.0.1', () => process.stdout.write(`http://127.0.0.1:${server.address().port}\n`));
