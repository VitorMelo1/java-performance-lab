import {readFile,writeFile,mkdir,readdir,stat,open} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const project=process.argv[2],session='diagnostico-20261029-033938-6a3f79';
const {analyzeRun}=await import(pathToFileURL(join(project,'benchmarks/quality.mjs')));
const json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
const readText=async p=>{const b=await readFile(p);return b.toString(b[0]===255&&b[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,'');};
const median=a=>{a=[...a].sort((a,b)=>a-b);return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;};
const stages=await json(join(project,'results',session,'batches.json'));
const out=join(project,'docs','diagnostico-20261029');await mkdir(out,{recursive:true});
const runs=[];
for(const stage of stages){
 const base=join(project,'results',stage.batch);
 for(const folder of await readdir(base)){
  if(!/^\d{3}-/.test(folder))continue;
  const dir=join(base,folder),r=await json(join(dir,'result.json')),q=await analyzeRun(dir),warm=await json(join(dir,'warmup','row.json'));
  for(const [key,qkey] of [['latency_p50_ms','p50_ms'],['latency_p95_ms','p95_ms'],['latency_p99_ms','p99_ms']])if(Math.abs(r[key]-q.latency[qkey])>1e-8)throw Error('Percentil divergente: '+folder+' '+key);
  const cpu={},cg=[];
  for(const line of (await readFile(join(dir,'resources.jsonl'),'utf8')).replace(/^\uFEFF/,'').trim().split(/\r?\n/)){
   if(!line)continue;
   for(let s of JSON.parse(line).stats??[]){if(typeof s==='string')s=JSON.parse(s);const v=parseFloat(s.CPUPerc);if(Number.isFinite(v))(cpu[s.Name]??=[]).push(v);}
  }
  for(const phase of ['before','after']){
   const text=await readText(join(dir,`cgroup-${phase}.txt`)),v={};
   for(const [,k,n] of text.matchAll(/^(usage_usec|nr_periods|nr_throttled|throttled_usec|oom|oom_kill) (\d+)/gm))v[k]=Number(n);
   cg.push(v);
  }
  const delta={};for(const k of Object.keys(cg[0]))delta[k]=cg[1][k]-cg[0][k];
  if(!(delta.nr_periods>0)||!(delta.nr_throttled>=0))throw Error('Cgroup ausente ou contador reiniciado: '+folder);
  const logs=await readFile(join(dir,'services.log'),'utf8');
  let jfr=null;
  if(stage.profile){const p=join(dir,'diagnostic.jfr'),h=await open(p);const b=Buffer.alloc(4);await h.read(b,0,4,0);await h.close();if(b.toString('hex')!=='464c5200')throw Error('JFR invalido');jfr={bytes:(await stat(p)).size,header:'FLR0'};}
  runs.push({stage:stage.stage,quick:stage.quick,batch:stage.batch,run:folder,variant:r.variant,offered_rps:r.offered_rps,p95_ms:q.latency.p95_ms,requests:r.requests,successful:r.successful_requests,errors:q.error_count,dropped:r.dropped_iterations,excluded:q.excluded_samples.count,stability:q.stability.status??q.stability,integrity:q.integrity,warmup_errors:warm.requests-warm.successful_requests,warmup_dropped:warm.dropped_iterations,cgroup_delta:delta,throttled_periods_percent:100*delta.nr_throttled/delta.nr_periods,cpu_medians:Object.fromEntries(Object.entries(cpu).map(([k,v])=>[k,median(v)])),netty_reference_exception:logs.includes('IllegalReferenceCountException'),r2dbc_connection_failure:logs.includes('Failed to obtain R2DBC Connection'),jfr});
  console.log('Verificada',runs.length,stage.stage,folder);
 }
}
const groups=[];
for(const r of runs.filter(x=>!x.quick)){
 let g=groups.find(x=>x.stage===r.stage&&x.variant===r.variant);if(!g){g={stage:r.stage,variant:r.variant,runs:[]};groups.push(g);}g.runs.push(r);
}
const aggregate=groups.map(g=>({stage:g.stage,variant:g.variant,n:g.runs.length,p95_median_ms:median(g.runs.map(r=>r.p95_ms)),p95_min_ms:Math.min(...g.runs.map(r=>r.p95_ms)),p95_max_ms:Math.max(...g.runs.map(r=>r.p95_ms)),dropped:g.runs.reduce((s,r)=>s+r.dropped,0),errors:g.runs.reduce((s,r)=>s+r.errors,0),throttled_periods_percent:g.runs.map(r=>r.throttled_periods_percent),app_cpu_medians:g.runs.map(r=>r.cpu_medians[`java-performance-lab-${r.variant}-1`])}));
const totals={};for(const [key,selected] of [['main',runs.filter(x=>!x.quick)],['smoke',runs.filter(x=>x.quick)]])totals[key]={runs:selected.length,requests:selected.reduce((s,r)=>s+r.requests,0),successful:selected.reduce((s,r)=>s+r.successful,0),errors:selected.reduce((s,r)=>s+r.errors,0),dropped:selected.reduce((s,r)=>s+r.dropped,0),excluded:selected.reduce((s,r)=>s+r.excluded,0),warmup_errors:selected.reduce((s,r)=>s+r.warmup_errors,0),warmup_dropped:selected.reduce((s,r)=>s+r.warmup_dropped,0)};
await writeFile(join(out,'validacao.json'),JSON.stringify({session,totals,aggregate,runs},null,2));
console.log(JSON.stringify({totals,aggregate},null,2));
