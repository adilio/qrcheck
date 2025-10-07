import fs from 'fs';
import http from 'http';
import https from 'https';

const port = Number(process.env.MOCK_PORT || 9090);
const certPath = process.env.MOCK_HTTPS_CERT;
const keyPath = process.env.MOCK_HTTPS_KEY;

const handler: http.RequestListener = (req, res) => {
  const url = new URL(req.url || '', 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/resolve') {
    res.end(
      JSON.stringify({
        hops: ['https://start.example', 'https://end.example'],
        final: 'https://end.example'
      })
    );
    return;
  }

  if (url.pathname === '/intel') {
    res.end(
      JSON.stringify({
        urlhaus: { query_status: 'no_results' },
        phishtank: { ok: true }
      })
    );
    return;
  }

  res.statusCode = 404;
  res.end();
};

const server = certPath && keyPath
  ? https.createServer(
      {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath)
      },
      handler
    )
  : http.createServer(handler);

server.listen(port, () => {
  const scheme = certPath && keyPath ? 'https' : 'http';
  console.log(`Mock API listening on ${scheme}://localhost:${port}`);
});
