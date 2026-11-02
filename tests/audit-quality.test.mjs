import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {analyzeRun} from '../benchmarks/quality.mjs';

async function fixture(t,{native=3,success=[1,1,1],count=3}={}){
 const folder=await mkdtemp(join(tmpdir(),'audit-quality-'));t.after(()=>rm(folder,{recursive:true,force:true}));
 const row={protocol_version:4,latency_metric:'request_latency_ms',timing_basis:'k6_http_duration',requests:count,successful_requests:count,offered_rps:1,scheduled_seconds:60,elapsed_seconds:60,invalid_rate:0,http_error_rate:0,dropped_iterations:0};
 const records=[{type:'Metric',metric:'http_reqs',data:{}}];
 for(let i=0;i<count;i++)for(const metric of ['http_reqs','request_latency_ms'])records.push({type:'Point',metric,data:{time:new Date(10000+i*1000).toISOString(),value:1}});
 for(let i=0;i<native;i++)records.push({type:'Point',metric:'http_req_duration',data:{time:new Date(10000+i*1000).toISOString(),value:1}});
 for(const value of success)records.push({type:'Point',metric:'successful_requests',data:{value}});
 await writeFile(join(folder,'row.json'),JSON.stringify(row));
 await writeFile(join(folder,'samples.json.gz'),gzipSync(records.map(x=>JSON.stringify(x)).join('\n')));
 return folder;
}
test('protocol 4 rejects missing native HTTP observations',async t=>{
 await assert.rejects(analyzeRun(await fixture(t,{native:2})),/nativa|native/i);
});
test('success totals must match the raw success counter',async t=>{
 await assert.rejects(analyzeRun(await fixture(t,{success:[1,0,1]})),/sucesso|corretas|successful/i);
});
