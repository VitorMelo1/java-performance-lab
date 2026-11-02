import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {aggregate,report} from '../benchmarks/report.mjs';
const row={protocol_version:4,analysis_status:'ok',variant:'mvc-resttemplate',scenario:'orders',offered_rps:1000,repetition:1,latency_p95_ms:10,requests:90000,successful_requests:90000,dropped_iterations:0,load_delivered:true};
test('unknown warmup incidents cannot be published as zero',()=>{
 const group=aggregate([row])[0];
 assert.equal(group.warmup_failed_responses,null);assert.equal(group.warmup_dropped_iterations,null);
});
test('a reset timeout counter must not turn into measurement timeouts',async t=>{
 const root=await mkdtemp(join(tmpdir(),'audit-report-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const b=join(root,'20261027-000000-abcdef'),run=join(b,'001-test');await mkdir(join(run,'warmup'),{recursive:true});
 await writeFile(join(b,'metadata.json'),JSON.stringify({protocolVersion:4}));
 await writeFile(join(b,'status.json'),JSON.stringify({state:'complete',completed:1,planned:1}));
 await writeFile(join(run,'result.json'),JSON.stringify(row));
 const sample=(v)=>JSON.stringify({timestamp:'2026-10-27T10:00:00Z',metrics:{'hikaricp.connections.timeout':{measurements:[{statistic:'COUNT',value:v}]}}});
 await writeFile(join(run,'warmup','jvm.jsonl'),sample(10));await writeFile(join(run,'jvm.jsonl'),sample(2));
 await report(b);const groups=JSON.parse(await readFile(join(b,'report','groups.json'),'utf8'));
 assert.equal(groups[0].app_pool_timeouts,null);
});
test('a reset GC counter cannot masquerade as a measured pause total',async t=>{
 const root=await mkdtemp(join(tmpdir(),'audit-gc-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const b=join(root,'20261027-000000-abcdef'),run=join(b,'001-test');await mkdir(join(run,'warmup'),{recursive:true});
 await writeFile(join(b,'metadata.json'),JSON.stringify({protocolVersion:4}));
 await writeFile(join(b,'status.json'),JSON.stringify({state:'complete',completed:1,planned:1}));
 await writeFile(join(run,'result.json'),JSON.stringify(row));
 const sample=v=>JSON.stringify({timestamp:'2026-10-27T10:00:00Z',metrics:{'jvm.gc.pause':{baseUnit:'seconds',measurements:[{statistic:'TOTAL_TIME',value:v},{statistic:'COUNT',value:v*10}]}}});
 await writeFile(join(run,'warmup','jvm.jsonl'),sample(10));await writeFile(join(run,'jvm.jsonl'),sample(2));
 await report(b);const groups=JSON.parse(await readFile(join(b,'report','groups.json'),'utf8'));
 assert.equal(groups[0].app_gc_pause_seconds_median,null);assert.equal(groups[0].app_gc_pause_count_median,null);
});
