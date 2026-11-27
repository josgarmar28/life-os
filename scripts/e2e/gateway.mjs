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

// DOBLE DE PRUEBA del Storage de Supabase (solo e2e): guarda los objetos en memoria y atiende lo que usa el dashboard
// (subir, firmar URL, descargar con firma, borrar). No comprueba políticas: esas se prueban en supabase/tests/95_wardrobe.
const objects = new Map(); // "bucket/ruta" -> { type, body }
const body = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
const json = (res, code, v) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };

/** Extrae el archivo de un multipart/form-data (lo que envía supabase-js al subir un Blob). */
function filePart(buf, contentType) {
  const m = /boundary=(.+)$/.exec(contentType ?? '');
  if (!m) return { type: contentType ?? 'application/octet-stream', body: buf };
  const sep = Buffer.from(`--${m[1]}`);
  let at = 0;
  while ((at = buf.indexOf(sep, at)) >= 0) {
    const headEnd = buf.indexOf('\r\n\r\n', at);
    const head = buf.subarray(at, headEnd).toString('latin1');
    const next = buf.indexOf(sep, headEnd);
    if (/filename=/.test(head) || /name=""/.test(head)) {
      const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1] ?? 'application/octet-stream';
      return { type, body: buf.subarray(headEnd + 4, next - 2) };
    }
    at = next < 0 ? buf.length : next;
  }
  return { type: 'application/octet-stream', body: buf };
}

async function storage(req, res, rel) {
  const url = new URL(rel, 'http://x');
  // Las URL firmadas se abren sin cabecera (las usa un <img>); todo lo demás exige sesión.
  const signedGet = req.method === 'GET' && url.pathname.startsWith('/object/sign/');
  if (!signedGet && !/^Bearer \S+/.test(req.headers.authorization ?? '')) return json(res, 401, { message: 'no token' });
  const parts = url.pathname.split('/').filter(Boolean); // object, ...
  if (req.method === 'POST' && parts[1] === 'sign' && parts.length === 3) {
    const { paths } = JSON.parse((await body(req)).toString() || '{}');
    return json(res, 200, paths.map((p) => ({ error: null, path: p, signedURL: `/object/sign/${parts[2]}/${p}?token=test` })));
  }
  if (req.method === 'GET' && parts[1] === 'sign') {
    const o = objects.get(parts.slice(2).join('/'));
    if (!o || url.searchParams.get('token') !== 'test') return json(res, 404, { message: 'not found' });
    res.writeHead(200, { 'content-type': o.type, 'cache-control': 'no-store' });
    return res.end(o.body);
  }
  if (req.method === 'POST' && parts[0] === 'object') {
    const f = filePart(await body(req), req.headers['content-type']);
    const key = parts.slice(1).join('/');
    if (objects.has(key)) return json(res, 400, { message: 'The resource already exists' });
    objects.set(key, f);
    return json(res, 200, { Key: key, Id: key });
  }
  if (req.method === 'DELETE' && parts[0] === 'object' && parts.length === 2) {
    const { prefixes } = JSON.parse((await body(req)).toString() || '{}');
    for (const p of prefixes) objects.delete(`${parts[1]}/${p}`);
    return json(res, 200, []);
  }
  if (req.method === 'GET' && parts[0] === '_count') return json(res, 200, { count: objects.size, keys: [...objects.keys()] });
  return json(res, 404, { message: 'not implemented in the test double' });
}

http.createServer((req, res) => {
  if ((req.url ?? '').startsWith('/storage/v1/')) { void storage(req, res, req.url.slice('/storage/v1'.length)); return; }
  const [target, path] = route(req.url ?? '/');
  const up = http.request({ host: '127.0.0.1', port: target, path, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${target}` } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(up);
}).listen(port, '127.0.0.1', () => console.log(`gateway :${port}`));
