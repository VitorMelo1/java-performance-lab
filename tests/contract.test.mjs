import {test} from 'node:test';
import assert from 'node:assert/strict';
const base = process.env.BASE_URL || 'http://mvc-resttemplate:8080';
const get = (path, options) => fetch(base + path, {...options, signal: AbortSignal.timeout(10000)});
const product = id => ({id, name: 'Produto ' + id, priceCents: 1000 + id, stock: 100});

test('SQL: registro conhecido, ausente e entrada inválida', async () => {
  const r = await get('/api/products/1');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), product(1));
  assert.equal((await get('/api/products/10001')).status, 404);
  for (const id of ['0', '-1', 'abc']) assert.equal((await get('/api/products/' + id)).status, 400);
});
test('SQL: atualização persiste e não cria registros ausentes', async () => {
  const put = (id, body) => get('/api/products/' + id + '/stock', {
    method:'PUT', headers:{'content-type':'application/json'}, body:JSON.stringify(body)
  });
  try {
    assert.deepEqual(await (await put(42, {stock:17})).json(), {...product(42), stock:17});
    assert.deepEqual(await (await get('/api/products/42')).json(), {...product(42), stock:17});
    for (const body of [{stock:-1}, {stock:1000001}, {}, {stock:null}])
      assert.equal((await put(42, body)).status, 400);
    assert.equal((await put(10001, {stock:10})).status, 404);
  } finally { assert.equal((await put(42, {stock:100})).status, 200); }
});
test('HTTP: conteúdo equivalente e atraso controlado', async () => {
  const start = performance.now();
  const r = await get('/api/remote/7?delayMs=100');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), {id:7, name:'Produto 7', priceCents:1007});
  assert.ok(performance.now() - start >= 85, 'a API precisa aguardar o upstream');
  for (const path of ['/api/remote/0', '/api/remote/1?delayMs=-1', '/api/remote/1?delayMs=1001'])
    assert.equal((await get(path)).status, 400);
});
test('HTTP: 404/503 e timeout remoto tornam-se 502, sem sucesso falso', async () => {
  for (const id of [10001, 99998, 99999])
    assert.equal((await get('/api/remote/' + id)).status, 502);
});
test('40 chamadas concorrentes preservam o conteúdo de cada solicitação', async () => {
  await Promise.all(Array.from({length:40}, async (_, index) => {
    const id = index + 1;
    const response = await get('/api/remote/' + id + '?delayMs=20');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {id, name:'Produto ' + id, priceCents:1000 + id});
  }));
});

