// Tiny static server for the browser tests: a blank page plus the adapters bundle.
// Serves over plain http on 127.0.0.1 so real cross-origin (CORS) rules apply.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const PORT = Number(process.env.PORT ?? 4173);
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>adapters</title><body></body>');
    } else if (req.url === '/adapters.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' }).end(await readFile('.browser-build/adapters.js'));
    } else {
      res.writeHead(404).end();
    }
  } catch {
    res.writeHead(500).end();
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`browser-test server on http://127.0.0.1:${PORT}`));
