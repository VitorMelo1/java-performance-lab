import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregate,serverWindow,report} from '../benchmarks/report.mjs';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const row={protocol_version:4,analysis_status:'ok',variant:'webflux',scenario:'db-read',offered_rps:1000,repetition:1,requests:89998,expected_requests:90000,successful_requests:89998,dropped_iterations:0,load_delivered:false,delivered_fraction:89998/90000,latency_p95_ms:2,latency_p99_ms:3,successful_rps:999,stability_status:'sem_alerta'};
test('delivery classification uses the saved quality verdict and missing is not success',()=>{
 assert.equal(aggregate([row])[0].load_delivered_repetitions,0);
 assert.equal(aggregate([{...row,load_delivered:undefined,expected_requests:undefined}])[0].load_delivered_repetitions,0);
 assert.equal(aggregate([{...row,load_delivered:true}])[0].load_delivered_repetitions,1);
});
test('missing or partial timeout coverage is unavailable',()=>{
 assert.equal(aggregate([row])[0].app_pool_timeouts,null);
 assert.equal(aggregate([row,{...row,app_pool_timeouts:2}])[0].app_pool_timeouts,null);
 assert.equal(aggregate([{...row,app_pool_timeouts:0}])[0].app_pool_timeouts,0);
});
test('partial counter reset is rejected, even if aggregate count increases',()=>{
 const before={buckets:new Map([[.001,10],[.01,20],[Infinity,30]]),count:30,sum:.2};
 const after={buckets:new Map([[.001,5],[.01,40],[Infinity,70]]),count:70,sum:.5};
 assert.equal(serverWindow(before,after),null);
});
test('zero bars, total JVM memory and approximate measurement windows are represented honestly',async()=>{
 const b=await mkdtemp(join(tmpdir(),'report-regression-'));
 try{
  await writeFile(join(b,'metadata.json'),JSON.stringify({protocolVersion:4}));
  await writeFile(join(b,'status.json'),JSON.stringify({state:'complete',planned:1,completed:1}));
  const d=join(b,'001-webflux-db-read-r1000-rep1');await mkdir(join(d,'warmup'),{recursive:true});
  await writeFile(join(d,'result.json'),JSON.stringify(row));
  const sample=(timestamp,value)=>({timestamp,metrics:{'jvm.memory.used':{measurements:[{statistic:'VALUE',value:300}]},'process.cpu.time':{baseUnit:'ns',measurements:[{statistic:'COUNT',value}]}}});
  await writeFile(join(d,'warmup','jvm.jsonl'),JSON.stringify(sample('2026-10-20T00:00:00Z',1e9)));
  await writeFile(join(d,'jvm.jsonl'),JSON.stringify(sample('2026-10-20T00:01:35Z',3e9)));
  await report(b);
  const svg=await readFile(join(b,'report','falhas-db-read.svg'),'utf8');assert.match(svg,/width="0" height="23"/);
  const csv=(await readFile(join(b,'report','rounds.csv'),'utf8')).trim().split('\n');const keys=csv[0].split(','),vals=csv[1].split(',').map(v=>v.slice(1,-1));const r=Object.fromEntries(keys.map((k,i)=>[k,vals[i]]));
  assert.equal(r.app_heap_used_bytes,'');assert.equal(r.app_memory_used_bytes,'300');assert.equal(r.app_cpu_window_seconds,'95');
 }finally{await rm(b,{recursive:true,force:true});}
});
