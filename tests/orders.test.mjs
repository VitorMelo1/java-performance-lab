import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base = process.env.BASE_URL || 'http://mvc-resttemplate:8080';
const request = (path, options) => fetch(base+path,{...options,signal:AbortSignal.timeout(10000)});
const post = body => request('/api/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

test('order records remote price and persists locally; duplicate cannot replace it', async () => {
  const id=randomUUID();
  const body={requestId:id,productId:7,quantity:3};
  const response=await post(body);
  assert.equal(response.status,201);
  const expected={requestId:id,productId:7,quantity:3,unitPriceCents:1007,totalCents:3021,status:'RECORDED'};
  assert.deepEqual(await response.json(),expected);
  assert.deepEqual(await (await request('/api/orders/'+id)).json(),expected);
  assert.equal((await post({...body,quantity:2})).status,409);
  assert.deepEqual(await (await request('/api/orders/'+id)).json(),expected);
});
test('invalid inputs and insufficient stock never create orders',async()=>{
  for(const fields of [{quantity:0},{quantity:101},{quantity:null},{productId:0},{requestId:'bad'}]){
    const id=randomUUID();
    assert.equal((await post({requestId:id,productId:1,quantity:1,...fields})).status,400);
    assert.equal((await request('/api/orders/'+id)).status,404);
  }
  const id=randomUUID();
  assert.equal((await post({requestId:id,productId:10000,quantity:1})).status,409);
  assert.equal((await request('/api/orders/'+id)).status,404);
});
test('missing remote product fails and leaves no local order',async()=>{
  const id=randomUUID();
  assert.equal((await post({requestId:id,productId:10001,quantity:1})).status,502);
  assert.equal((await request('/api/orders/'+id)).status,404);
});
test('concurrent requests persist independently with their own prices',async()=>{
  await Promise.all(Array.from({length:20},async(_,i)=>{
    const id=randomUUID(),productId=i+1;
    const r=await post({requestId:id,productId,quantity:2});
    assert.equal(r.status,201);
    const stored=await (await request('/api/orders/'+id)).json();
    assert.equal(stored.requestId,id);assert.equal(stored.totalCents,(1001+i)*2);
  }));
});
