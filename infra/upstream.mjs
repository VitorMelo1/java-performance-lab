import http from 'node:http';
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://upstream');
  const send = (status, body) => {
    res.writeHead(status, {'content-type': 'application/json'});
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/health') return send(200, {status: 'UP'});
  const match = /^\/catalog\/(\d+)$/.exec(url.pathname);
  if (!match) return send(404, {error: 'not_found'});
  const id = Number(match[1]);
  const delay = Number(url.searchParams.get('delayMs') ?? 0);
  if (!Number.isSafeInteger(id) || !Number.isInteger(delay) || delay < 0 || delay > 1000)
    return send(400, {error: 'invalid_input'});
  // IDs reservados permitem testar propagação de falhas sem mudar o cenário normal.
  if (id === 99998) return send(503, {error: 'unavailable'});
  if (id === 99999) return setTimeout(() => send(200, {id, name: 'late', priceCents: 1}), 3500);
  if (id < 1 || id > 10000) return send(404, {error: 'not_found'});
  setTimeout(() => send(200, {id, name: 'Produto ' + id, priceCents: 1000 + id}), delay);
});
server.keepAliveTimeout = 65000;
server.listen(9090, '0.0.0.0');

