// Pasarela local que imita la de Supabase (Kong): un único origen con /auth/v1, /rest/v1 y
// /functions/v1, más el dashboard compilado. Solo para pruebas end-to-end; nunca se despliega.
import http from 'node:http';

const [port, auth, rest, fn, web] = process.argv.slice(2).map(Number);

const route = (url) => {
  if (url.startsWith('/auth/v1/')) return [auth, url.slice('/auth/v1'.length)];
  if (url.startsWith('/rest/v1/')) return [rest, url.slice('/rest/v1'.length)];
  if (url.startsWith('/functions/v1/')) return [fn, url];
  // Descubrimiento RFC 8414 para el emisor .../auth/v1
  if (url.startsWith('/.well-known/oauth-authorization-server/auth/v1')) return [auth, '/.well-known/oauth-authorization-server'];
  return [web, url];
};

http.createServer((req, res) => {
  const [target, path] = route(req.url ?? '/');
  const up = http.request({ host: '127.0.0.1', port: target, path, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${target}` } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(up);
}).listen(port, '127.0.0.1', () => console.log(`gateway :${port}`));
