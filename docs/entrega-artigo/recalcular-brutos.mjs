// Node.js 18+; extract both publication ZIPs into the same directory first.
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyzeRun} from './benchmarks/quality.mjs';
const root=process.argv[2]?resolve(process.argv[2]):dirname(fileURLToPath(import.meta.url));
const checks=[];
for(const batch of (await readdir(join(root,'dados'))).sort()){
 for(const run of (await readdir(join(root,'dados',batch))).sort()){
  if(!/^\d{3}-/.test(run))continue;
  const path=join(root,'dados',batch,run),q=await analyzeRun(path);
  const r=JSON.parse((await readFile(join(path,'result.json'),'utf8')).replace(/^\uFEFF/,''));
  for(const [k,qk] of [['latency_p50_ms','p50_ms'],['latency_p95_ms','p95_ms'],['latency_p99_ms','p99_ms']]){
   if(Math.abs(r[k]-q.latency[qk])>1e-8)throw Error(`${batch}/${run}: ${k} divergiu`);
  }
  checks.push({batch,run,requests:q.integrity.row_requests,successful:q.integrity.raw_successful_requests,excluded:q.excluded_samples.count,percentiles:'match'});
  console.log('Verificadas',checks.length,batch,run);
 }
}
if(checks.length!==302)throw Error('Esperadas 302 rodadas, incluindo 20 testes curtos');
await writeFile(join(root,'conferencia-brutos.json'),JSON.stringify(checks,null,2));
console.log('Conferencia concluida: 302 rodadas; consulte conferencia-brutos.json.');
