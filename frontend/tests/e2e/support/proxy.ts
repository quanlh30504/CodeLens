import http from 'node:http';

/**
 * Same-origin front door for the end-to-end run, standing in for Nginx (deploy/nginx/default.conf):
 * `/api/*` goes to the API, everything else to the web app, so cookies behave as in production.
 */
export function startProxy(port: number, apiPort: number, webPort: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const target = req.url?.startsWith('/api/') ? apiPort : webPort;
    const upstream = http.request(
      { host: '127.0.0.1', port: target, path: req.url, method: req.method, headers: { ...req.headers, host: req.headers.host } },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
