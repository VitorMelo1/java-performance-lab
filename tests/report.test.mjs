import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {aggregate,report,parsePrometheusHistogram,serverWindow} from '../benchmarks/report.mjs';

// Exposicao do Micrometer: baldes cumulativos com rotulo `le`, um conjunto de rotulos por
// rota/metodo/status. O coletor do laboratorio bate no /actuator durante a medicao, e essas
// requisicoes nao podem entrar na distribuicao que se quer medir.
function scrape(bounds,counts,{actuator=0,count=null,sum=null}={}){
  const lines=[
    '# HELP http_server_requests_seconds',
    '# TYPE http_server_requests_seconds histogram',
  ];
  const tags='error="none",method="GET",outcome="SUCCESS",status="200",uri="/api/products/{id}"';
  bounds.forEach((bound,i)=>lines.push(`http_server_requests_seconds_bucket{${tags},le="${bound}"} ${counts[i]}.0`));
  lines.push(`http_server_requests_seconds_bucket{${tags},le="+Inf"} ${counts[counts.length-1]}.0`);
  if(count!==null)lines.push(`http_server_requests_seconds_count{${tags}} ${count}.0`);
  if(sum!==null)lines.push(`http_server_requests_seconds_sum{${tags}} ${sum}`);
  if(actuator){
    const other='error="none",method="GET",outcome="SUCCESS",status="200",uri="/actuator/metrics/{requiredMetricName}"';
    for(const bound of bounds)lines.push(`http_server_requests_seconds_bucket{${other},le="${bound}"} ${actuator}.0`);
    lines.push(`http_server_requests_seconds_bucket{${other},le="+Inf"} ${actuator}.0`);
    lines.push(`http_server_requests_seconds_count{${other}} ${actuator}.0`);
    lines.push(`http_server_requests_seconds_sum{${other}} 9.9`);
  }
  return lines.join('\n')+'\n';
}

test('server-side percentiles come from the measured window, not from JVM start',()=>{
  const bounds=[0.001,0.005,0.01,0.1];
  // Aquecimento deixou 1.000 requisicoes acumuladas antes de a medicao comecar.
  const before=parsePrometheusHistogram(scrape(bounds,[500,900,1000,1000],{count:1000,sum:2.0}));
  // Medicao somou 10.000: 5.000 ate 1 ms, 9.500 ate 5 ms, 10.000 ate 10 ms.
  const after=parsePrometheusHistogram(scrape(bounds,[5500,10400,11000,11000],{count:11000,sum:27.0}));
  const w=serverWindow(before,after);
  assert.equal(w.samples,10000);
  assert.equal(w.requests,10000);
  assert.equal(w.saturated,false);
  assert.ok(w.p50_ms>0.9&&w.p50_ms<1.1,`p50=${w.p50_ms}`);
  assert.ok(w.p95_ms>4.5&&w.p95_ms<5.5,`p95=${w.p95_ms}`);
  assert.ok(Math.abs(w.mean_ms-2.5)<1e-9,`media=${w.mean_ms}`);
});

test('actuator polling is excluded from the server-side distribution',()=>{
  const bounds=[0.001,0.005];
  const plain=parsePrometheusHistogram(scrape(bounds,[100,200],{count:200,sum:0.5}));
  const polluted=parsePrometheusHistogram(scrape(bounds,[100,200],{count:200,sum:0.5,actuator:40}));
  assert.deepEqual([...polluted.buckets.entries()],[...plain.buckets.entries()]);
  assert.equal(polluted.count,plain.count);
});

test('a quantile landing in the +Inf bucket is reported unavailable, not invented',()=>{
  const bounds=[0.001,0.005];
  const before=parsePrometheusHistogram(scrape(bounds,[0,0],{count:0,sum:0}));
  // 1.000 requisicoes, mas so 900 couberam no maior limite finito: o p95 cai em +Inf.
  const text=scrape(bounds,[500,900],{count:1000,sum:50})
    .replace('le="+Inf"} 900.0','le="+Inf"} 1000.0');
  const w=serverWindow(before,parsePrometheusHistogram(text));
  assert.equal(w.samples,1000);
  assert.equal(w.saturated,true);
  assert.equal(w.p95_ms,null);
  assert.ok(w.p50_ms>0&&w.p50_ms<=5);
  assert.equal(w.highest_bound_ms,5);
});

test('a restart mid-run cannot produce negative bucket differences',()=>{
  const bounds=[0.001,0.005];
  const before=parsePrometheusHistogram(scrape(bounds,[900,1000],{count:1000,sum:2}));
  const after=parsePrometheusHistogram(scrape(bounds,[100,200],{count:200,sum:0.4}));
  const w=serverWindow(before,after);
  assert.equal(w,null);
});
test('report keeps saturation rows, excludes corrupt rows and never pools request percentiles',()=>{
  const rows=[10,20,90].map((p,i)=>({protocol_version:3,variant:'webflux',scenario:'orders',offered_rps:500,repetition:i+1,analysis_status:'ok',latency_p95_ms:p,latency_p99_ms:p*2,successful_rps:400,requests:500,successful_requests:490,dropped_iterations:10,stability_status:'variacao_detectada'}));
  rows.push({...rows[0],analysis_status:'invalid',latency_p95_ms:10000});
  const g=aggregate(rows)[0];
  assert.equal(g.n,3);assert.equal(g.p95_median,20);assert.equal(g.p95_min,10);assert.equal(g.p95_max,90);
  assert.equal(g.failed_responses,30);assert.equal(g.dropped_iterations,30);
});
test('older protocol is not silently mixed into the comparison',()=>{
  assert.throws(()=>aggregate([{protocol_version:2}]),/protocolo/i);
});

test('reports reject pooling batches measured by different clock revisions',()=>{
  assert.throws(()=>aggregate([
    {protocol_version:3,analysis_status:'ok'},
    {protocol_version:3,analysis_status:'ok',timing_revision:'monotonic-anchor-v1'},
  ]),/relógio|revis/i);
});

test('report excludes hours-long run from normal 90-second comparison',()=>{
  const row={protocol_version:3,variant:'webflux',scenario:'db-read',offered_rps:1000,repetition:1,
    analysis_status:'ok',scheduled_seconds:90,elapsed_seconds:33434.295,latency_p95_ms:212.44,
    latency_p99_ms:109962,successful_rps:2.6,requests:87558,successful_requests:87558,
    dropped_iterations:2443,stability_status:'variacao_detectada'};
  assert.deepEqual(aggregate([row]),[]);
});

test('report exposes warmup and measurement incidents without excluding their measured runs',()=>{
  const base={protocol_version:3,variant:'mvc-feign',scenario:'orders',offered_rps:500,
    analysis_status:'ok',scheduled_seconds:90,elapsed_seconds:90,latency_p95_ms:7,
    latency_p99_ms:9,successful_rps:500,requests:45000,successful_requests:45000,
    dropped_iterations:0,stability_status:'sem_alerta',warmup_failed_responses:0,
    warmup_dropped_iterations:0};
  const rows=[
    {...base,repetition:1},
    {...base,repetition:2,requests:43938,successful_requests:43758,dropped_iterations:1063,
      warmup_failed_responses:246,warmup_dropped_iterations:8276,stability_status:'variacao_detectada'},
    {...base,repetition:3},
  ];
  const g=aggregate(rows)[0];
  assert.equal(g.n,3);
  assert.equal(g.warmup_affected_repetitions,1);
  assert.equal(g.warmup_failed_responses,246);
  assert.equal(g.warmup_dropped_iterations,8276);
  assert.equal(g.measurement_affected_repetitions,1);
  assert.equal(g.failed_responses,180);
  assert.equal(g.dropped_iterations,1063);
  assert.equal(g.temporal_warnings,1);
});

test('report reads the preserved warmup summary into derived CSV and HTML',async()=>{
  const batch=await mkdtemp(join(tmpdir(),'java-report-'));
  try{
    await writeFile(join(batch,'metadata.json'),JSON.stringify({protocolVersion:3,quick:false}));
    await writeFile(join(batch,'status.json'),JSON.stringify({state:'complete',completed:1,planned:1}));
    const run=join(batch,'001-mvc-feign-orders-r500-rep1');
    await mkdir(join(run,'warmup'),{recursive:true});
    await writeFile(join(run,'result.json'),JSON.stringify({protocol_version:3,run:'001-mvc-feign-orders-r500-rep1',variant:'mvc-feign',scenario:'orders',offered_rps:500,repetition:1,analysis_status:'ok',scheduled_seconds:90,elapsed_seconds:90,latency_p95_ms:8,latency_p99_ms:12,successful_rps:480,requests:43938,successful_requests:43758,dropped_iterations:1063,stability_status:'variacao_detectada'}));
    await writeFile(join(run,'warmup','row.json'),JSON.stringify({requests:21724,successful_requests:21478,dropped_iterations:8276,latency_p95_ms:3008.8}));
    await report(batch);
    const rounds=await readFile(join(batch,'report','rounds.csv'),'utf8');
    const groups=await readFile(join(batch,'report','groups.csv'),'utf8');
    const html=await readFile(join(batch,'report','index.html'),'utf8');
    assert.match(rounds,/warmup_failed_responses/);
    assert.match(rounds,/"246"/);
    assert.match(groups,/warmup_affected_repetitions/);
    assert.match(groups,/"8276"/);
    assert.match(html,/Aquecimento/);
    assert.match(html,/180/);
  }finally{await rm(batch,{recursive:true,force:true});}
});

const base4={protocol_version:4,timing_revision:'monotonic-anchor-v1',analysis_status:'ok',
  scheduled_seconds:90,elapsed_seconds:90,requests:90000,successful_requests:90000,
  expected_requests:90000,delivered_fraction:1,dropped_iterations:0,stability_status:'sem_alerta',
  latency_p95_ms:5,latency_p99_ms:9,successful_rps:1000};

test('a group whose load was not delivered is flagged as not latency-comparable',()=>{
  const full=[1,2,3].map(r=>({...base4,variant:'webflux',scenario:'orders',offered_rps:500,repetition:r}));
  const short=[1,2,3].map(r=>({...base4,variant:'mvc-feign',scenario:'orders',offered_rps:1000,repetition:r,
    requests:62511,delivered_fraction:62511/90000,dropped_iterations:27490,successful_rps:693.3,latency_p95_ms:1351}));
  const groups=aggregate([...full,...short]);
  const ok=groups.find(g=>g.variant==='webflux');
  const saturated=groups.find(g=>g.variant==='mvc-feign');
  assert.equal(ok.comparable_latency,true);
  assert.equal(ok.load_delivered_repetitions,3);
  assert.equal(ok.delivered_fraction_median,1);
  assert.equal(saturated.comparable_latency,false);
  assert.equal(saturated.load_delivered_repetitions,0);
  assert.ok(saturated.delivered_fraction_median<0.7);
});

test('protocol 4 is accepted and never pooled with protocol 3',()=>{
  assert.equal(aggregate([{...base4,variant:'webflux',scenario:'db-read',offered_rps:200,repetition:1}]).length,1);
  assert.throws(()=>aggregate([
    {...base4,variant:'webflux',scenario:'db-read',offered_rps:200,repetition:1},
    {...base4,protocol_version:3,variant:'webflux',scenario:'db-read',offered_rps:200,repetition:2},
  ]),/protocolo/i);
});

test('CSV columns stay aligned when the first row lacks a later field',async()=>{
  const batch=await mkdtemp(join(tmpdir(),'java-report-'));
  try{
    await writeFile(join(batch,'metadata.json'),JSON.stringify({protocolVersion:4,quick:false}));
    await writeFile(join(batch,'status.json'),JSON.stringify({state:'complete',completed:2,planned:2}));
    const broken=join(batch,'001-webflux-db-read-r200-rep1');
    const whole=join(batch,'002-webflux-db-read-r200-rep2');
    await mkdir(broken,{recursive:true});await mkdir(whole,{recursive:true});
    // A rodada invalidada não tem stability_status; antes, por ser a primeira pasta lida,
    // o cabeçalho saía dela e deslocava as colunas das rodadas completas.
    await writeFile(join(broken,'result.json'),JSON.stringify({...base4,run:'001-webflux-db-read-r200-rep1',
      variant:'webflux',scenario:'db-read',offered_rps:200,repetition:1,analysis_status:'invalid',
      stability_status:undefined}));
    await writeFile(join(whole,'result.json'),JSON.stringify({...base4,run:'002-webflux-db-read-r200-rep2',
      variant:'webflux',scenario:'db-read',offered_rps:200,repetition:2,excluded_samples:2}));
    await report(batch);
    const rounds=(await readFile(join(batch,'report','rounds.csv'),'utf8')).trim().split('\n');
    const header=rounds[0].split(',');
    assert.ok(header.includes('stability_status'));
    for(const line of rounds.slice(1))assert.equal(line.split('","').length,header.length);
    const html=await readFile(join(batch,'report','index.html'),'utf8');
    assert.match(html,/001-webflux-db-read-r200-rep1/);
  }finally{await rm(batch,{recursive:true,force:true});}
});

test('one figure per scenario, so a saturated scenario cannot flatten the SQL scale',async()=>{
  const batch=await mkdtemp(join(tmpdir(),'java-report-'));
  try{
    await writeFile(join(batch,'metadata.json'),JSON.stringify({protocolVersion:4,quick:false}));
    await writeFile(join(batch,'status.json'),JSON.stringify({state:'complete',completed:2,planned:2}));
    for(const[index,cell]of[['001','db-read',2.4],['002','orders',1351]].entries()){
      const[name,scenario,p95]=cell;
      const run=join(batch,`${name}-webflux-${scenario}-r1000-rep1`);
      await mkdir(run,{recursive:true});
      await writeFile(join(run,'result.json'),JSON.stringify({...base4,run:`${name}-webflux-${scenario}-r1000-rep1`,
        variant:'webflux',scenario,offered_rps:1000,repetition:1,latency_p95_ms:p95}));
      void index;
    }
    const out=await report(batch);
    const files=await readdir(out);
    assert.ok(files.includes('latencia-p95-db-read.svg'));
    assert.ok(files.includes('latencia-p95-orders.svg'));
    const sql=await readFile(join(out,'latencia-p95-db-read.svg'),'utf8');
    // A escala do cenário SQL termina em 2,4 ms, não nos 1351 ms do cenário saturado.
    assert.match(sql,/latência p95 · db-read/i);
    assert.ok(!sql.includes('1351.00'));
  }finally{await rm(batch,{recursive:true,force:true});}
});

// Forma exata que o Actuator devolveu na coleta de 15 out.: jvm.gc.pause e um Timer em
// segundos, process.cpu.time e um contador de funcao com estatistica COUNT em
// NANOSSEGUNDOS, e hikaricp.connections.acquire e um Timer em segundos. Pedir VALUE em
// process.cpu.time, ou assumir segundos, deixava a coluna de CPU por requisicao vazia nas
// 72 rodadas sem nenhum erro aparente.
const gcSample=(count,total,max,cpuNanos=null)=>JSON.stringify({timestamp:'t',metrics:{
  'jvm.gc.pause':{baseUnit:'seconds',measurements:[{statistic:'COUNT',value:count},{statistic:'TOTAL_TIME',value:total},{statistic:'MAX',value:max}]},
  'jvm.threads.live':{measurements:[{statistic:'VALUE',value:21}]},
  ...(cpuNanos===null?{}:{'process.cpu.time':{baseUnit:'ns',measurements:[{statistic:'COUNT',value:cpuNanos}]}})}});

test('CPU per request reads the COUNT statistic and converts nanoseconds',async()=>{
  const batch=await mkdtemp(join(tmpdir(),'java-report-'));
  try{
    await writeFile(join(batch,'metadata.json'),JSON.stringify({protocolVersion:4,quick:false}));
    await writeFile(join(batch,'status.json'),JSON.stringify({state:'complete',completed:1,planned:1}));
    const run=join(batch,'001-webflux-db-read-r1000-rep1');
    await mkdir(join(run,'warmup'),{recursive:true});
    await writeFile(join(run,'result.json'),JSON.stringify({...base4,run:'001-webflux-db-read-r1000-rep1',
      variant:'webflux',scenario:'db-read',offered_rps:1000,repetition:1,
      requests:90000,successful_requests:90000,successful_rps:1000}));
    // Valores reais da rodada 001: 57,76 s de CPU ao fim do aquecimento, 116,26 s ao fim
    // da medicao. Janela = 58,5 s para 90.000 requisicoes = 0,65 ms de CPU por requisicao.
    await writeFile(join(run,'warmup','jvm.jsonl'),gcSample(40,1.2,0.08,57_760_000_000));
    await writeFile(join(run,'jvm.jsonl'),gcSample(170,5.077,0.206,116_260_000_000));
    await report(batch);
    const rounds=JSON.parse(await readFile(join(batch,'report','groups.json'),'utf8'));
    const seconds=(116_260_000_000-57_760_000_000)/1e9;
    assert.ok(Math.abs(rounds[0].app_cpu_ms_per_request_median-seconds*1000/90000)<1e-9,
      `CPU por requisicao=${rounds[0].app_cpu_ms_per_request_median}`);
    assert.ok(rounds[0].app_cpu_ms_per_request_median>0.6&&rounds[0].app_cpu_ms_per_request_median<0.7);
  }finally{await rm(batch,{recursive:true,force:true});}
});

test('an unknown unit yields null instead of a silently mis-scaled number',async()=>{
  const batch=await mkdtemp(join(tmpdir(),'java-report-'));
  try{
    await writeFile(join(batch,'metadata.json'),JSON.stringify({protocolVersion:4,quick:false}));
    await writeFile(join(batch,'status.json'),JSON.stringify({state:'complete',completed:1,planned:1}));
    const run=join(batch,'001-webflux-db-read-r1000-rep1');
    await mkdir(join(run,'warmup'),{recursive:true});
    await writeFile(join(run,'result.json'),JSON.stringify({...base4,run:'001-webflux-db-read-r1000-rep1',
      variant:'webflux',scenario:'db-read',offered_rps:1000,repetition:1,successful_requests:90000}));
    const odd=cpu=>JSON.stringify({timestamp:'t',metrics:{
      'process.cpu.time':{baseUnit:'furlongs',measurements:[{statistic:'COUNT',value:cpu}]}}});
    await writeFile(join(run,'warmup','jvm.jsonl'),odd(1));
    await writeFile(join(run,'jvm.jsonl'),odd(2));
    await report(batch);
    const rows=await readFile(join(batch,'report','rounds.csv'),'utf8');
    const header=rows.trim().split('\n')[0].split(',');
    const line=rows.trim().split('\n')[1].split('","');
    const at=name=>line[header.indexOf(`${name}`)]?.replace(/"/g,'');
    assert.equal(at('app_cpu_seconds'),'');
    assert.equal(at('app_cpu_ms_per_request'),'');
  }finally{await rm(batch,{recursive:true,force:true});}
});

test('GC pauses and container CPU reach the per-round table',async()=>{
  const batch=await mkdtemp(join(tmpdir(),'java-report-'));
  try{
    await writeFile(join(batch,'metadata.json'),JSON.stringify({protocolVersion:4,quick:false}));
    await writeFile(join(batch,'status.json'),JSON.stringify({state:'complete',completed:1,planned:1}));
    const run=join(batch,'001-webflux-orders-r1000-rep1');
    await mkdir(join(run,'warmup'),{recursive:true});
    await writeFile(join(run,'result.json'),JSON.stringify({...base4,run:'001-webflux-orders-r1000-rep1',
      variant:'webflux',scenario:'orders',offered_rps:1000,repetition:1,successful_rps:910}));
    // Contadores acumulados desde o inicio da JVM: o aquecimento ja gastou 1,2 s em 40
    // pausas antes da medicao comecar. A janela medida precisa ser a diferenca.
    await writeFile(join(run,'warmup','jvm.jsonl'),[gcSample(10,0.3,0.05),gcSample(40,1.2,0.08)].join('\n'));
    await writeFile(join(run,'jvm.jsonl'),[gcSample(90,2.9,0.15),gcSample(170,5.077,0.206)].join('\n'));
    await writeFile(join(run,'resources.jsonl'),[
      {timestamp:'a',stats:[JSON.stringify({Name:'java-performance-lab-webflux-1',CPUPerc:'140.00%',MemUsage:'500MiB / 1GiB'})]},
      {timestamp:'b',stats:[JSON.stringify({Name:'java-performance-lab-webflux-1',CPUPerc:'146.00%',MemUsage:'510MiB / 1GiB'})]},
    ].map(x=>JSON.stringify(x)).join('\n'));
    await report(batch);
    const groups=JSON.parse(await readFile(join(batch,'report','groups.json'),'utf8'));
    assert.ok(Math.abs(groups[0].app_gc_pause_seconds_median-(5.077-1.2))<1e-9);
    assert.equal(groups[0].app_gc_pause_count_median,130);
    assert.equal(groups[0].app_gc_window,'entre_ultimas_amostras_aquecimento_medicao');
    assert.equal(groups[0].app_gc_pause_max_ms_median,206);
    assert.equal(groups[0].app_threads_median,21);
    assert.equal(groups[0].app_cpu_percent_median,143);
    assert.ok(Math.abs(groups[0].app_cpu_percent_per_1000_rps-143/910*1000)<1e-9);
  }finally{await rm(batch,{recursive:true,force:true});}
});

test('server latency and CPU per request reach groups.csv end to end',async()=>{
  const batch=await mkdtemp(join(tmpdir(),'java-report-'));
  try{
    await writeFile(join(batch,'metadata.json'),JSON.stringify({protocolVersion:4,quick:false}));
    await writeFile(join(batch,'status.json'),JSON.stringify({state:'complete',completed:1,planned:1}));
    const run=join(batch,'001-webflux-db-read-r1000-rep1');
    await mkdir(join(run,'warmup'),{recursive:true});
    await writeFile(join(run,'result.json'),JSON.stringify({...base4,run:'001-webflux-db-read-r1000-rep1',
      variant:'webflux',scenario:'db-read',offered_rps:1000,repetition:1,
      requests:90000,successful_requests:90000,successful_rps:1000}));
    const bounds=[0.001,0.005,0.01,0.1];
    await writeFile(join(run,'prometheus-before.txt'),scrape(bounds,[500,900,1000,1000],{count:1000,sum:2.0}));
    await writeFile(join(run,'prometheus-after.txt'),scrape(bounds,[45500,86400,91000,91000],{count:91000,sum:92.0}));
    // process.cpu.time cumulativo: 30 s no aquecimento, 150 s ao fim da medicao, na forma
    // real do Actuator (estatistica COUNT, baseUnit ns).
    const cpu=(seconds,gc)=>JSON.stringify({timestamp:'t',metrics:{
      'process.cpu.time':{baseUnit:'ns',measurements:[{statistic:'COUNT',value:seconds*1e9}]},
      'jvm.gc.pause':{baseUnit:'seconds',measurements:[{statistic:'COUNT',value:gc},{statistic:'TOTAL_TIME',value:gc/100},{statistic:'MAX',value:0.02}]}}});
    await writeFile(join(run,'warmup','jvm.jsonl'),cpu(30,40));
    await writeFile(join(run,'jvm.jsonl'),cpu(150,170));
    await report(batch);
    const groups=JSON.parse(await readFile(join(batch,'report','groups.json'),'utf8'));
    const rounds=await readFile(join(batch,'report','rounds.csv'),'utf8');
    assert.equal(groups[0].server_histogram_saturated_repetitions,0);
    assert.ok(groups[0].server_p95_median>4.5&&groups[0].server_p95_median<5.5,`p95=${groups[0].server_p95_median}`);
    // 120 s de CPU para 90.000 requisicoes = 1,333 ms de CPU por requisicao.
    assert.ok(Math.abs(groups[0].app_cpu_ms_per_request_median-120*1000/90000)<1e-9);
    assert.match(rounds,/server_p95_ms/);
    assert.match(rounds,/janela_medida/);
    const files=await readdir(join(batch,'report'));
    assert.ok(files.includes('latencia-servidor-p95-db-read.svg'));
  }finally{await rm(batch,{recursive:true,force:true});}
});

test('without a warmup sample the GC total is labelled cumulative instead of silently wrong',async()=>{
  const batch=await mkdtemp(join(tmpdir(),'java-report-'));
  try{
    await writeFile(join(batch,'metadata.json'),JSON.stringify({protocolVersion:4,quick:false}));
    await writeFile(join(batch,'status.json'),JSON.stringify({state:'complete',completed:1,planned:1}));
    const run=join(batch,'001-webflux-orders-r1000-rep1');
    await mkdir(run,{recursive:true});
    await writeFile(join(run,'result.json'),JSON.stringify({...base4,run:'001-webflux-orders-r1000-rep1',
      variant:'webflux',scenario:'orders',offered_rps:1000,repetition:1,successful_rps:910}));
    await writeFile(join(run,'jvm.jsonl'),gcSample(170,5.077,0.206));
    await report(batch);
    const groups=JSON.parse(await readFile(join(batch,'report','groups.json'),'utf8'));
    assert.equal(groups[0].app_gc_pause_seconds_median,5.077);
    assert.equal(groups[0].app_gc_window,'cumulativo_inclui_aquecimento');
  }finally{await rm(batch,{recursive:true,force:true});}
});
