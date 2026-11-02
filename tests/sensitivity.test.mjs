import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {reviewAnomalousRun,sensitivityReport} from '../benchmarks/sensitivity.mjs';

async function fixture(t, {total=1000, negatives=1, nativeNegatives=negatives}={}) {
  const folder=await mkdtemp(join(tmpdir(),'java-sensitivity-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const records=[];
  for(let i=0;i<total;i++) {
    const value=i<negatives?-1:5;
    records.push({type:'Point',metric:'request_latency_ms',data:{time:new Date(1760000000000+i).toISOString(),value}});
    records.push({type:'Point',metric:'http_req_duration',data:{value:i<nativeNegatives?-1:5}});
    records.push({type:'Point',metric:'http_reqs',data:{value:1}});
  }
  const file=join(folder,'samples.json.gz');
  await writeFile(file,gzipSync(records.map(x=>JSON.stringify(x)).join('\n')));
  return {folder,file,row:{protocol_version:3,requests:total,scheduled_seconds:90,elapsed_seconds:90}};
}

test('isolates a rare negative native timing without altering raw samples',async t=>{
  const {folder,file,row}=await fixture(t);
  const before=await readFile(file);
  const result=await reviewAnomalousRun(folder,row);
  assert.equal(result.negative_samples,1);
  assert.equal(result.valid_samples,999);
  assert.equal(result.raw_http_requests,1000);
  assert.equal(result.latency_p95_ms,5);
  assert.deepEqual(await readFile(file),before);
});

test('does not rescue a run with too many impossible timings',async t=>{
  const {folder,row}=await fixture(t,{negatives:2});
  await assert.rejects(reviewAnomalousRun(folder,row),/limite|0,1%/i);
});

test('requires the built-in duration to confirm each impossible timing',async t=>{
  const {folder,row}=await fixture(t,{nativeNegatives:0});
  await assert.rejects(reviewAnomalousRun(folder,row),/métrica nativa|nativa/i);
});

test('generated sensitivity note reports the actual number of affected runs',async t=>{
  const source=await fixture(t);
  const batch=await mkdtemp(join(tmpdir(),'java-sensitivity-batch-'));
  t.after(()=>rm(batch,{recursive:true,force:true}));
  const name='001-webflux-db-read-r200-rep1',run=join(batch,name);
  await mkdir(run);
  await copyFile(source.file,join(run,'samples.json.gz'));
  await writeFile(join(batch,'metadata.json'),JSON.stringify({protocolVersion:3}));
  await writeFile(join(batch,'status.json'),JSON.stringify({protocol:3,state:'complete',completed:1}));
  await writeFile(join(run,'result.json'),JSON.stringify({...source.row,run:name,variant:'webflux',scenario:'db-read',offered_rps:200,repetition:1,analysis_status:'invalid',successful_requests:1000,successful_rps:11,dropped_iterations:0,latency_p95_ms:5,latency_p99_ms:5}));
  const {output,summary}=await sensitivityReport(batch);
  assert.equal(summary.supplemental_accepted,1);
  assert.match(await readFile(join(output,'LEIA-ME.md'),'utf8'),/percentis de 1 rodada/);
});
