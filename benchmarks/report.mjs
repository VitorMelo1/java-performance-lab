import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {catalog} from './catalog.mjs';
const median=a=>{a=[...a].sort((a,b)=>a-b);return a.length ? (a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2 : null;};
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
// O cabeçalho vem da união das chaves de todas as linhas, não da primeira: uma rodada com
// conjunto de campos diferente deslocaria silenciosamente as colunas de todas as outras.
const csv=rows=>{
  if(!rows.length)return '';
  const keys=[];
  for(const row of rows)for(const key of Object.keys(row))if(!keys.includes(key))keys.push(key);
  return keys.join(',')+'\n'+rows.map(r=>keys.map(k=>'"'+String(r[k]??'').replaceAll('"','""')+'"').join(',')).join('\n')+'\n';
};
const usable=row=>row.analysis_status==='ok' &&
  !(Number.isFinite(row.elapsed_seconds) && Number.isFinite(row.scheduled_seconds) &&
    row.elapsed_seconds>row.scheduled_seconds+30);
// Carga entregue por rodada: sem descartes e com a contagem observada no alvo.
const delivered=row=>row.dropped_iterations===0 && (typeof row.load_delivered==='boolean'
  ?row.load_delivered
  :Number.isFinite(row.expected_requests)&&Number.isFinite(row.requests)&&row.requests>=row.expected_requests-1);
export function aggregate(rows){
  const versions=new Set(rows.map(r=>r.protocol_version));
  if(versions.size>1)throw Error('Não misture protocolos em uma agregação; cada lote tem o seu.');
  const [version]=versions;
  if(rows.length && !(version>=3))throw Error(`Não misture protocolos; este relatório aceita protocolo 3 ou 4, não ${version}.`);
  if(new Set(rows.map(r=>r.timing_revision||'original-civil-clock')).size>1)throw Error('Não misture revisões de relógio em uma agregação.');
  const groups=new Map();
  for(const row of rows.filter(usable)){
    const key=[row.scenario,row.offered_rps,row.variant].join('|');
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
  }
  return [...groups.values()].map(rs=>{
    const a=rs[0],p95=rs.map(r=>r.latency_p95_ms).filter(Number.isFinite),p99=rs.map(r=>r.latency_p99_ms).filter(Number.isFinite);
    const fractions=rs.map(r=>Number.isFinite(r.delivered_fraction)?r.delivered_fraction:
      (Number.isFinite(r.expected_requests)&&r.expected_requests>0?r.requests/r.expected_requests:null)).filter(Number.isFinite);
    const deliveredAll=rs.every(delivered);
    return {scenario:a.scenario,offered_rps:a.offered_rps,variant:a.variant,n:rs.length,
      latency_n:p95.length,p95_median:median(p95),p95_min:p95.length?Math.min(...p95):null,p95_max:p95.length?Math.max(...p95):null,
      p99_median:median(p99),successful_rps_median:median(rs.map(r=>r.successful_rps).filter(Number.isFinite)),
      // Comparar p95 entre braços só faz sentido quando os braços entregaram a mesma
      // carga. delivered_fraction e load_delivered_repetitions tornam isso explícito.
      delivered_fraction_median:median(fractions),
      load_delivered_repetitions:rs.filter(delivered).length,
      warmup_plateau_delivered_fraction_median:median(rs.map(r=>r.warmup_plateau_delivered_fraction).filter(Number.isFinite)),
      above_knee_repetitions:rs.filter(r=>r.above_knee===true).length,
      // Comparavel exige carga entregue na medicao E plato do aquecimento na taxa alvo:
      // uma celula acima do joelho tem p95 de um laco fechado, nao de carga aberta.
      comparable_latency:deliveredAll&&!rs.some(r=>r.above_knee===true),
      blocked_p95_median:median(rs.map(r=>r.blocked_p95_ms).filter(Number.isFinite)),
      client_p95_median:median(rs.map(r=>r.client_p95_ms).filter(Number.isFinite)),
      // Segunda fonte de latencia, medida dentro da aplicacao. Divergencia grande contra
      // p95_median aponta custo no gerador ou no caminho de rede, nao na aplicacao.
      server_p50_median:median(rs.map(r=>r.server_p50_ms).filter(Number.isFinite)),
      server_p95_median:median(rs.map(r=>r.server_p95_ms).filter(Number.isFinite)),
      server_p99_median:median(rs.map(r=>r.server_p99_ms).filter(Number.isFinite)),
      server_mean_median:median(rs.map(r=>r.server_mean_ms).filter(Number.isFinite)),
      server_histogram_saturated_repetitions:rs.filter(r=>r.server_histogram_saturated===true).length,
      app_cpu_ms_per_request_median:median(rs.map(r=>r.app_cpu_ms_per_request).filter(Number.isFinite)),
      app_pool_timeouts:rs.every(r=>Number.isFinite(r.app_pool_timeouts))?rs.reduce((s,r)=>s+r.app_pool_timeouts,0):null,
      app_pool_acquire_max_ms_median:median(rs.map(r=>r.app_pool_acquire_max_ms).filter(Number.isFinite)),
      app_pool_pending_capacity_median:median(rs.map(r=>r.app_pool_pending_capacity).filter(Number.isFinite)),
      app_cpu_percent_median:median(rs.map(r=>r.app_cpu_percent_median).filter(Number.isFinite)),
      app_cpu_percent_per_1000_rps:median(rs.map(r=>Number.isFinite(r.app_cpu_percent_median)&&r.successful_rps>0
        ? r.app_cpu_percent_median/r.successful_rps*1000 : null).filter(Number.isFinite)),
      app_gc_pause_seconds_median:median(rs.map(r=>r.app_gc_pause_seconds).filter(Number.isFinite)),
      app_gc_pause_count_median:median(rs.map(r=>r.app_gc_pause_count).filter(Number.isFinite)),
      app_gc_pause_max_ms_median:median(rs.map(r=>r.app_gc_pause_max_ms_cumulative).filter(Number.isFinite)),
      app_gc_window:[...new Set(rs.map(r=>r.app_gc_window).filter(Boolean))].join('+'),
      app_threads_median:median(rs.map(r=>r.app_threads_live).filter(Number.isFinite)),
      excluded_samples:rs.reduce((s,r)=>s+(r.excluded_samples||0),0),
      failed_responses:rs.reduce((s,r)=>s+r.requests-r.successful_requests,0),
      dropped_iterations:rs.reduce((s,r)=>s+r.dropped_iterations,0),
      measurement_affected_repetitions:rs.filter(r=>r.requests>r.successful_requests||r.dropped_iterations>0).length,
      warmup_affected_repetitions:rs.filter(r=>r.warmup_failed_responses>0||r.warmup_dropped_iterations>0).length,
      warmup_unavailable_repetitions:rs.filter(r=>!Number.isFinite(r.warmup_failed_responses)||!Number.isFinite(r.warmup_dropped_iterations)).length,
      warmup_failed_responses:rs.every(r=>Number.isFinite(r.warmup_failed_responses))?rs.reduce((s,r)=>s+r.warmup_failed_responses,0):null,
      warmup_dropped_iterations:rs.every(r=>Number.isFinite(r.warmup_dropped_iterations))?rs.reduce((s,r)=>s+r.warmup_dropped_iterations,0):null,
      temporal_warnings:rs.filter(r=>r.stability_status!=='sem_alerta').length};
  }).sort((a,b)=>a.scenario.localeCompare(b.scenario)||a.offered_rps-b.offered_rps||a.variant.localeCompare(b.variant));
}
// Uma figura por cenário: a escala é calculada dentro do cenário. Com um eixo linear
// compartilhado, orders a 1000 req/s (centenas de ms) reduzia as barras de SQL (1-5 ms)
// a uma lasca de um pixel, e o gráfico deixava de informar.
function chart(groups,rows,field,title,unit,options={}){
  if(!groups.length)return '';
  const W=1100,left=395,right=95,H=100+groups.length*42;
  const max=Math.max(1,...groups.map(g=>field==='p95_median'?g.p95_max:g[field]).filter(Number.isFinite));
  const x=v=>left+(W-left-right)*v/max;
  const colors={'webflux':'#0f766e','mvc-feign':'#8b5cf6','mvc-resttemplate':'#2563eb','inventory':'#64748b'};
  const legend=['failed_responses','dropped_iterations','excluded_samples'].includes(field)?'barras: soma das rodadas':field==='p95_median'?'barras: mediana; pontos: repetições; linha: mínimo–máximo':'barras: mediana entre rodadas';
  let s=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial,sans-serif" fill="#172033"><text x="24" y="30" font-size="20" font-weight="bold">${escape(title)}</text><text x="24" y="53" font-size="12">${escape(unit)} · ${legend}${options.note?' · '+escape(options.note):''}</text>`;
  for(let t=0;t<=4;t++){const v=max*t/4;s+=`<line x1="${x(v)}" x2="${x(v)}" y1="70" y2="${H-28}" stroke="#e2e8f0"/><text x="${x(v)}" y="${H-10}" font-size="11">${v.toFixed(1)}</text>`;}
  groups.forEach((g,i)=>{
    const y=80+i*42,v=g[field],c=colors[g.variant]||'#475569';
    const caveat=(g.n<3?' n<3':'')+(field==='p95_median'&&!g.comparable_latency?' carga não entregue':'');
    s+=`<text x="24" y="${y+15}" font-size="12">${escape(g.scenario)} · ${g.offered_rps}/s · ${escape(g.variant)} (n=${g.n})${escape(caveat)}</text>`;
    if(Number.isFinite(v)){
      const hatch=field==='p95_median'&&!g.comparable_latency;
      s+=`<rect x="${left}" y="${y}" width="${Math.max(0,x(v)-left)}" height="23" rx="3" fill="${c}" opacity="${hatch?'.35':'.8'}"${hatch?' stroke="'+c+'" stroke-dasharray="4 3"':''}/>`;
      if(field==='p95_median'){
        s+=`<line x1="${x(g.p95_min)}" x2="${x(g.p95_max)}" y1="${y+11}" y2="${y+11}" stroke="#0f172a"/>`;
        for(const r of rows.filter(r=>usable(r)&&r.scenario===g.scenario&&r.variant===g.variant&&r.offered_rps===g.offered_rps&&Number.isFinite(r.latency_p95_ms)))s+=`<circle cx="${x(r.latency_p95_ms)}" cy="${y+11}" r="3" fill="#0f172a"/>`;
      }
      s+=`<text x="${Math.min(W-80,x(field==='p95_median'?g.p95_max:v)+8)}" y="${y+16}" font-size="12">${v.toFixed(2)}</text>`;
    }else s+=`<text x="${left}" y="${y+15}" font-size="12">sem amostras</text>`;
  });return s+'</g></svg>';
}
async function readJson(path){return JSON.parse((await readFile(path,'utf8')).replace(/^﻿/,''));}
export async function addWarmup(row,folder){
  try{
    const warmup=await readJson(join(folder,'warmup','row.json'));
    row.warmup_requests=warmup.requests;
    row.warmup_successful_requests=warmup.successful_requests;
    row.warmup_failed_responses=warmup.requests-warmup.successful_requests;
    row.warmup_dropped_iterations=warmup.dropped_iterations;
    row.warmup_delivered_fraction=warmup.delivered_fraction ?? null;
    row.warmup_p95_ms=warmup.latency_p95_ms;
    row.warmup_shape=row.warmup_shape ?? warmup.load_shape ?? warmup.warmup_shape ?? null;
    // O plato do aquecimento diz se a celula esta acima do joelho: a aplicacao nao
    // sustenta a taxa alvo nem aquecida, e o p95 dela nao e comparavel entre bracos.
    row.warmup_plateau_delivered_fraction=warmup.plateau_delivered_fraction ?? null;
    row.warmup_plateau_p95_ms=warmup.plateau_p95_ms ?? null;
    if(row.above_knee===undefined){
      row.above_knee=Number.isFinite(warmup.plateau_delivered_fraction)
        ?warmup.plateau_delivered_fraction<0.99:null;
    }
  }catch(e){if(e.code!=='ENOENT')throw e;
    row.warmup_requests=null;row.warmup_successful_requests=null;row.warmup_failed_responses=null;
    row.warmup_dropped_iterations=null;row.warmup_delivered_fraction=null;row.warmup_p95_ms=null;
    row.warmup_shape=null;row.warmup_plateau_delivered_fraction=null;row.warmup_plateau_p95_ms=null;
  }
  return row;
}
/** CPU do container da aplicação e pausas de GC entram na tabela por rodada: a leitura
 *  de latência sob saturação depende delas, e ler os CSV de recursos à mão não escala. */
function summarizeResources(row,samples){
  const appNames=[`java-performance-lab-${row.variant}-1`,'java-performance-lab-stock-service-1'];
  const cpu=[];
  for(const sample of samples){
    if(!appNames.includes(sample.container))continue;
    if(sample.container.includes('stock-service')&&row.variant!=='inventory')continue;
    const value=Number(String(sample.cpu_percent).replace('%',''));
    if(Number.isFinite(value))cpu.push(value);
  }
  row.app_cpu_percent_median=median(cpu);
  row.app_cpu_samples=cpu.length;
  return row;
}
/** Soma os baldes cumulativos de http.server.requests por `le`, somando todos os
 *  conjuntos de rotulos. Requisicoes ao proprio Actuator ficam de fora: o coletor bate no
 *  /actuator a cada 3 s e entraria na distribuicao que se quer medir. */
export function parsePrometheusHistogram(text,metric='http_server_requests'){
  const buckets=new Map();
  let count=null,sum=null;
  const name=metric.replace(/[.]/g,'_');
  // O conjunto de rotulos contem chaves: as rotas sao templates, como
  // uri="/api/products/{id}". Delimitar os rotulos com [^}]* parava dentro do proprio
  // rotulo e nenhuma linha casava. O `.*` guloso recua ate o ultimo } antes do valor.
  const line=new RegExp(`^${name}(?:_seconds)?_(bucket|count|sum)\\{(.*)\\}\\s+([0-9.eE+-]+)\\s*$`);
  for(const raw of text.split('\n')){
    const match=line.exec(raw.trim());
    if(!match)continue;
    const [,kind,labels,value]=match;
    if(/(?:^|,)uri="\/actuator/.test(labels))continue;
    const amount=Number(value);
    if(!Number.isFinite(amount))continue;
    if(kind==='bucket'){
      const le=/(?:^|,)le="([^"]+)"/.exec(labels)?.[1];
      if(le===undefined)continue;
      const bound=le==='+Inf'?Infinity:Number(le);
      if(!Number.isFinite(bound)&&bound!==Infinity)continue;
      buckets.set(bound,(buckets.get(bound)??0)+amount);
    }else if(kind==='count')count=(count??0)+amount;
    else sum=(sum??0)+amount;
  }
  if(!buckets.size)return null;
  return {buckets,count,sum};
}
/** Diferenca entre dois scrapes e percentis da janela, no estilo histogram_quantile. */
export function serverWindow(before,after){
  if(!after)return null;
  const bounds=[...new Set([...after.buckets.keys(),...(before?before.buckets.keys():[])])].sort((a,b)=>a-b);
  const cumulative=bounds.map(b=>(after.buckets.get(b)??0)-(before?before.buckets.get(b)??0:0));
  if(cumulative.some((v,i)=>v<0||(i>0&&v<cumulative[i-1])))return null;
  if(before&&((after.count!==null&&before.count!==null&&after.count<before.count)||(after.sum!==null&&before.sum!==null&&after.sum<before.sum)))return null;
  const total=cumulative[cumulative.length-1]??0;
  const count=after.count===null?null:after.count-(before?.count??0);
  const sum=after.sum===null?null:after.sum-(before?.sum??0);
  if(count!==null&&Math.abs(count-total)>1e-6)return null;
  const quantile=q=>{
    if(!total)return null;
    const target=q*total;
    for(let i=0;i<bounds.length;i++){
      if(cumulative[i]<target)continue;
      if(!Number.isFinite(bounds[i]))return {ms:null,saturated:true};
      const lowBound=i?bounds[i-1]:0,lowCount=i?cumulative[i-1]:0;
      const span=cumulative[i]-lowCount;
      const position=span>0?(target-lowCount)/span:0;
      return {ms:(lowBound+(bounds[i]-lowBound)*position)*1000,saturated:false};
    }
    return {ms:null,saturated:true};
  };
  const p50=quantile(0.5),p95=quantile(0.95),p99=quantile(0.99);
  return {
    samples:total,requests:count,
    p50_ms:p50?.ms??null,p95_ms:p95?.ms??null,p99_ms:p99?.ms??null,
    mean_ms:count>0&&sum!==null?sum/count*1000:null,
    // Acima do maior limite finito o histograma nao distingue valores; o percentil cai no
    // balde +Inf e fica indisponivel em vez de ser inventado.
    saturated:Boolean(p95?.saturated||p99?.saturated),
    highest_bound_ms:Math.max(...bounds.filter(Number.isFinite))*1000,
  };
}
async function addServerMetrics(row,folder){
  row.server_p50_ms=null;row.server_p95_ms=null;row.server_p99_ms=null;row.server_mean_ms=null;
  row.server_requests=null;row.server_histogram_saturated=null;row.server_source='indisponivel';
  const read=async name=>{
    try{return parsePrometheusHistogram(await readFile(join(folder,name),'utf8'));}
    catch(e){if(e.code==='ENOENT')return null;throw e;}
  };
  const after=await read('prometheus-after.txt');
  if(!after)return row;
  const before=await read('prometheus-before.txt');
  const window=serverWindow(before,after);
  if(!window){row.server_source='histograma_invalido';return row;}
  if(!before){row.server_source='cumulativo_sem_scrape_inicial';return row;}
  row.server_p50_ms=window.p50_ms;row.server_p95_ms=window.p95_ms;row.server_p99_ms=window.p99_ms;
  row.server_mean_ms=window.mean_ms;row.server_requests=window.requests;
  row.server_histogram_saturated=window.saturated;
  row.server_source=before?'janela_medida':'cumulativo_sem_scrape_inicial';
  return row;
}
/** Acesso as amostras do Actuator. A estatistica varia por tipo de medidor: um Timer
 *  publica COUNT/TOTAL_TIME/MAX, um gauge publica VALUE e um contador de funcao publica
 *  COUNT. E a unidade vem em baseUnit, nao e sempre segundos: process.cpu.time vem em ns.
 *  Pedir a estatistica errada devolvia null em silencio e a coluna saia vazia. */
async function readJvmSamples(file){
  let text;
  try{text=await readFile(file,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}
  const lines=text.replace(/^﻿/,'').trim().split('\n').filter(Boolean);
  if(!lines.length)return null;
  const entries=metric=>{
    const found=[];
    for(let i=lines.length-1;i>=0;i--){
      const sample=JSON.parse(lines[i]),entry=sample.metrics?.[metric];
      if(entry&&!('collectionError' in entry))found.push({...entry,collectedAt:sample.timestamp});
    }
    return found;
  };
  return {
    value(metric,...statistics){
      for(const entry of entries(metric)){
        for(const statistic of statistics){
          const found=entry.measurements?.find(m=>m.statistic===statistic)?.value;
          if(Number.isFinite(found))return found;
        }
      }
      return null;
    },
    timestamp(metric,statistic){
      for(const entry of entries(metric))if(entry.measurements?.some(m=>m.statistic===statistic&&Number.isFinite(m.value)))return entry.collectedAt??null;
      return null;
    },
    unit(metric){
      for(const entry of entries(metric))if(entry.baseUnit)return entry.baseUnit;
      return null;
    },
  };
}
/** Converte para segundos pela unidade declarada. Unidade desconhecida devolve null em
 *  vez de adivinhar: errar a escala por 10^9 passaria despercebido numa tabela. */
function toSeconds(value,unit){
  if(!Number.isFinite(value))return null;
  if(unit==='ns'||unit==='nanoseconds')return value/1e9;
  if(unit==='ms'||unit==='milliseconds')return value/1e3;
  if(unit==='s'||unit==='seconds')return value;
  return null;
}
/** jvm.gc.pause COUNT e TOTAL_TIME sao contadores acumulados desde o inicio da JVM, e a
 *  aplicacao e reiniciada a cada rodada com o aquecimento rodando antes da medicao: ler o
 *  ultimo valor atribuiria a medicao tambem o GC do aquecimento. A janela medida e a
 *  diferenca contra o ultimo valor do aquecimento. MAX e um maximo em janela deslizante
 *  do Micrometer, nao um contador: a diferenca nao tem significado e ele fica registrado
 *  como cumulativo, podendo incluir pausas do aquecimento. */
async function addJvm(row,folder){
  row.app_gc_pause_seconds=null;row.app_gc_pause_count=null;
  row.app_gc_pause_seconds_cumulative=null;row.app_gc_pause_max_ms_cumulative=null;
  row.app_threads_live=null;row.app_heap_used_bytes=null;row.app_gc_window='indisponivel';
  const measurement=await readJvmSamples(join(folder,'jvm.jsonl'));
  if(!measurement)return row;
  const warmup=await readJvmSamples(join(folder,'warmup','jvm.jsonl'));
  for(const [label,metric,statistic] of [['cpu','process.cpu.time','COUNT'],['gc','jvm.gc.pause','TOTAL_TIME']]){
    row[`app_${label}_window_start`]=warmup?.timestamp(metric,statistic)??null;
    row[`app_${label}_window_end`]=measurement.timestamp(metric,statistic);
    const seconds=(Date.parse(row[`app_${label}_window_end`])-Date.parse(row[`app_${label}_window_start`]))/1000;
    row[`app_${label}_window_seconds`]=Number.isFinite(seconds)&&seconds>0?seconds:null;
  }
  const gcUnit=measurement.unit('jvm.gc.pause');
  const total=toSeconds(measurement.value('jvm.gc.pause','TOTAL_TIME'),gcUnit);
  const count=measurement.value('jvm.gc.pause','COUNT');
  const max=toSeconds(measurement.value('jvm.gc.pause','MAX'),gcUnit);
  row.app_gc_pause_seconds_cumulative=total;
  row.app_gc_pause_max_ms_cumulative=Number.isFinite(max)?max*1000:null;
  const warmTotal=warmup?toSeconds(warmup.value('jvm.gc.pause','TOTAL_TIME'),warmup.unit('jvm.gc.pause')):null;
  const warmCount=warmup?warmup.value('jvm.gc.pause','COUNT'):null;
  if(Number.isFinite(total)&&Number.isFinite(warmTotal)&&total>=warmTotal){
    row.app_gc_pause_seconds=total-warmTotal;
    row.app_gc_window='entre_ultimas_amostras_aquecimento_medicao';
  }else if(Number.isFinite(total)&&Number.isFinite(warmTotal)&&total<warmTotal){
    row.app_gc_window='contador_reiniciado';
  }else if(Number.isFinite(total)){
    // Sem amostra de aquecimento (lote do protocolo 3) o valor segue cumulativo e inclui
    // o aquecimento; a coluna app_gc_window registra isso em vez de omitir.
    row.app_gc_pause_seconds=total;
    row.app_gc_window='cumulativo_inclui_aquecimento';
  }
  if(Number.isFinite(count)&&Number.isFinite(warmCount)&&count>=warmCount)row.app_gc_pause_count=count-warmCount;
  else if(Number.isFinite(count)&&!Number.isFinite(warmCount))row.app_gc_pause_count=count;
  row.app_threads_live=measurement.value('jvm.threads.live','VALUE');
  row.app_memory_used_bytes=measurement.value('jvm.memory.used','VALUE');
  // Unfiltered Actuator metric includes heap and non-heap; no heap-only sample exists.
  row.app_heap_used_bytes=null;
  // process.cpu.time e cumulativo: a CPU gasta na janela medida e a diferenca, nao a
  // mediana de 'docker stats'. Da a CPU por requisicao sem erro de amostragem. O medidor
  // publica a estatistica COUNT, em nanossegundos.
  row.app_cpu_seconds=null;row.app_cpu_ms_per_request=null;
  const cpuUnit=measurement.unit('process.cpu.time');
  const cpu=toSeconds(measurement.value('process.cpu.time','COUNT','VALUE'),cpuUnit);
  const warmCpu=warmup?toSeconds(warmup.value('process.cpu.time','COUNT','VALUE'),warmup.unit('process.cpu.time')):null;
  if(Number.isFinite(cpu)&&Number.isFinite(warmCpu)&&cpu>=warmCpu)row.app_cpu_seconds=cpu-warmCpu;
  if(Number.isFinite(row.app_cpu_seconds)&&row.successful_requests>0){
    row.app_cpu_ms_per_request=row.app_cpu_seconds*1000/row.successful_requests;
  }
  // Timeouts de aquisicao do Hikari: contador cumulativo, imune a amostragem grossa.
  row.app_pool_timeouts=null;
  const timeouts=measurement.value('hikaricp.connections.timeout','COUNT');
  const warmTimeouts=warmup?warmup.value('hikaricp.connections.timeout','COUNT'):null;
  row.app_pool_timeouts_cumulative=Number.isFinite(timeouts)?timeouts:null;
  if(Number.isFinite(timeouts)&&Number.isFinite(warmTimeouts)&&timeouts>=warmTimeouts)
    row.app_pool_timeouts=timeouts-warmTimeouts;
  const acquireSeconds=toSeconds(measurement.value('hikaricp.connections.acquire','MAX'),
    measurement.unit('hikaricp.connections.acquire'));
  row.app_pool_acquire_max_ms=Number.isFinite(acquireSeconds)?acquireSeconds*1000:null;
  row.app_pool_pending_capacity=measurement.value('r2dbc.pool.max.pending','VALUE');
  return row;
}
export async function report(batch){
  const metadata=await readJson(join(batch,'metadata.json'));
  if(!(metadata.protocolVersion>=3))throw Error('Relatório requer protocolo 3 ou 4.');
  const status=await readJson(join(batch,'status.json'));
  const rows=[];
  const resources=[];
  for(const entry of await readdir(batch,{withFileTypes:true})){
    if(!entry.isDirectory()||!/^\d{3}-/.test(entry.name))continue;
    let row;
    try{row=await readJson(join(batch,entry.name,'result.json'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
    await addWarmup(row,join(batch,entry.name));
    await addJvm(row,join(batch,entry.name));
    await addServerMetrics(row,join(batch,entry.name));
    const own=[];
    try{
      const lines=(await readFile(join(batch,entry.name,'resources.jsonl'),'utf8')).replace(/^﻿/,'').trim().split('\n');
      for(const line of lines){
        if(!line)continue;
        const sample=JSON.parse(line);
        for(const raw of sample.stats||[]){const r=typeof raw==='string'?JSON.parse(raw):raw;
          const record={run:entry.name,variant:row.variant,scenario:row.scenario,offered_rps:row.offered_rps,repetition:row.repetition,timestamp:sample.timestamp,container:r.Name,cpu_percent:r.CPUPerc,memory:r.MemUsage,memory_percent:r.MemPerc,network:r.NetIO,block_io:r.BlockIO,pids:r.PIDs};
          resources.push(record);own.push(record);}
      }
    }catch(e){if(e.code!=='ENOENT')throw e;}
    summarizeResources(row,own);
    rows.push(row);
  }
  const groups=aggregate(rows),out=join(batch,'report');await mkdir(out,{recursive:true});
  await writeFile(join(out,'rounds.csv'),csv(rows));await writeFile(join(out,'groups.csv'),csv(groups));await writeFile(join(out,'resources.csv'),csv(resources));
  await writeFile(join(out,'groups.json'),JSON.stringify(groups,null,2));
  const scenarios=[...new Set(groups.map(g=>g.scenario))].sort();
  const charts=[['p95_median','latencia-p95','Latência p95','ms'],
    ['p99_median','latencia-p99','Latência p99','ms'],
    ['successful_rps_median','vazao','Vazão de respostas corretas','respostas/s'],
    ['delivered_fraction_median','entrega','Fração da carga oferecida que foi entregue','1,0 = carga integral'],
    ['server_p95_median','latencia-servidor-p95','Latência p95 medida dentro da aplicação','ms'],
    ['app_cpu_ms_per_request_median','cpu-por-requisicao','CPU estimada por resposta correta','ms de CPU; janela amostrada aproximada'],
    ['app_cpu_percent_per_1000_rps','cpu-container-por-requisicao','CPU do container por 1.000 respostas/s','% de um núcleo'],
    ['app_gc_pause_seconds_median','gc','Pausas de GC no intervalo observado','segundos; consultar app_gc_window no CSV'],
    ['failed_responses','falhas','Respostas incorretas ou falhas','soma das rodadas'],
    ['dropped_iterations','descartes','Iterações não iniciadas','soma das rodadas']];
  const figures=[];
  for(const[field,file,title,unit]of charts){
    for(const scenario of scenarios){
      const subset=groups.filter(g=>g.scenario===scenario);
      if(!subset.some(g=>Number.isFinite(g[field])))continue;
      const note=field==='p95_median'&&subset.some(g=>!g.comparable_latency)
        ?'barra tracejada: carga não entregue, p95 não comparável entre braços':'';
      const svg=chart(subset,rows,field,`${title} · ${scenario}`,unit,{note});
      if(!svg)continue;
      await writeFile(join(out,`${file}-${scenario}.svg`),svg);figures.push(svg);
    }
  }
  const excludedRuns=rows.filter(r=>!usable(r)).map(r=>r.run??'(sem nome)');
  const warning=`Estado do lote: ${status.state}. Rodadas terminadas: ${status.completed}/${status.planned}. Rodadas excluídas dos gráficos por análise inválida ou duração anômala: ${excludedRuns.length}${excludedRuns.length?' ('+excludedRuns.map(escape).join(', ')+')':''}. ${metadata.quick?'ENSAIO CURTO — não usar como resultado científico.':''}`;
  const incidentGroups=groups.filter(g=>g.n<3||g.measurement_affected_repetitions||g.temporal_warnings||g.warmup_affected_repetitions||!g.comparable_latency||g.excluded_samples);
  const incidents=incidentGroups.map(g=>`<tr><td>${escape(g.scenario)} · ${g.offered_rps}/s · ${escape(g.variant)}</td><td>${g.n}</td><td>${g.load_delivered_repetitions}/${g.n}</td><td>${g.delivered_fraction_median===null?'—':g.delivered_fraction_median.toFixed(4)}</td><td>${g.warmup_affected_repetitions}/${g.n}</td><td>${g.measurement_affected_repetitions}/${g.n}</td><td>${g.failed_responses}</td><td>${g.dropped_iterations}</td><td>${g.excluded_samples}</td><td>${g.temporal_warnings}</td></tr>`).join('');
  let sensitivity='';
  try{const summary=await readJson(join(batch,'sensitivity','summary.json'));
    sensitivity=`<p>Análise de sensibilidade posterior à coleta: ${summary.total_analyzable} rodadas analisáveis após remover ${summary.negative_samples} durações negativas pontuais; ${summary.primary_accepted} aceitas pela análise principal. Esta regra não valida retroativamente as rodadas excluídas. <a href="../sensitivity/LEIA-ME.md">Critérios e limites</a> · <a href="../sensitivity/groups.csv">Grupos da sensibilidade</a>.</p>`;
  }catch(e){if(e.code!=='ENOENT')throw e;}
  const html=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Comparação Java · protocolo ${metadata.protocolVersion}</title><style>body{font:16px/1.6 system-ui;margin:40px auto;padding:0 24px;max-width:1150px;color:#172033;background:#f8fafc}h1{line-height:1.2}section{background:white;padding:20px;margin:24px 0;border:1px solid #e2e8f0;border-radius:12px}svg{width:100%;height:auto}.notice{background:#fff7ed;padding:20px;border-left:4px solid #c2410c}a{color:#1d4ed8}table{border-collapse:collapse;width:100%}td,th{padding:6px;border-bottom:1px solid #e2e8f0;text-align:left}th{font-size:13px}.scroll{overflow:auto}</style><h1>MVC e WebFlux: resultados do protocolo ${metadata.protocolVersion}</h1><p class="notice">${escape(warning)}</p><p>Resultados desta máquina e desta configuração. Latência = envio + espera + recebimento HTTP do k6, excluindo estabelecimento da conexão; <code>blocked_p95_median</code> e <code>client_p95_median</code> em groups.csv mostram o bloqueio do gerador e a soma observada pelo cliente. Os pontos do p95 mostram cada repetição; a linha mostra mínimo e máximo. Não é intervalo de confiança.</p><p>Uma resposta rápida com erros não significa melhor desempenho. Leia latência, vazão, falhas e descartes em conjunto. <strong>Onde a carga oferecida não foi entregue, o p95 não é comparável entre braços</strong>: compare vazão alcançada e CPU por requisição. Essas barras aparecem tracejadas e a coluna de entrega está na tabela de incidentes.</p>${sensitivity}<p><a href="rounds.csv">Todas as rodadas, incluindo aquecimento, CPU e GC</a> · <a href="groups.csv">Medianas e amplitude</a> · <a href="resources.csv">CPU, memória e I/O por container</a></p><section><h2>Aquecimento e incidentes</h2><p>O aquecimento sobe a carga em degrau até a taxa alvo antes da medição, para que carregar classes e encher pools não apareça como carga não entregue. Descartes ou erros nele não invalidam automaticamente a medição, mas indicam que a carga não foi entregue integralmente naquele período. O código 99 do k6 é acionado por limites de erros ou descartes; consulte as contagens, não apenas o código. A coluna de amostras retiradas mostra durações impossíveis removidas ponto a ponto dentro do orçamento declarado. Todas as contagens são soma das rodadas estruturalmente válidas.</p><div class="scroll"><table><thead><tr><th>Cenário · carga · variante</th><th>n</th><th>Repetições com carga entregue</th><th>Fração entregue (mediana)</th><th>Aquecimentos com perdas/falhas</th><th>Medições com perdas/falhas</th><th>Falhas na medição</th><th>Descartes na medição</th><th>Amostras retiradas</th><th>Alertas temporais</th></tr></thead><tbody>${incidents}</tbody></table></div><p>O número n deve ser comparado com as repetições planejadas: n menor que 3 pode ser previsto no plano ou resultar de exclusões. A mediana de p95 pode ocultar um incidente em apenas uma repetição; confira os pontos no gráfico e o CSV por rodada.</p></section>${figures.map(s=>'<section>'+s+'</section>').join('')}<section><h2>Como interpretar</h2><p>p95 de 100 ms significa que 95% das requisições observadas tiveram duração de até 100 ms. Compare as variantes dentro do mesmo cenário e da mesma carga, e somente onde a carga foi entregue. O controle inventory consulta apenas o estoque e ajuda a investigar limites da dependência; não executa o mesmo trabalho que orders.</p><p><strong>Há duas fontes de latência independentes.</strong> <code>p95_median</code> é medida pelo gerador; <code>server_p95_median</code> vem do histograma de <code>http.server.requests</code> da própria aplicação, pela diferença entre dois scrapes que delimitam a janela medida — sem o relógio do gerador e sem o tempo de bloqueio dele. Os histogramas usam interpolação em baldes e fronteiras distintas das amostras HTTP. Uma divergência não isola, por si só, a origem do custo. Sem scrape inicial ou com contadores inconsistentes, os percentis do servidor ficam indisponíveis. Onde o percentil cai no balde <code>+Inf</code> ele fica indisponível em vez de ser estimado, e a coluna de repetições saturadas registra isso.</p><p>CPU por requisição vem de <code>process.cpu.time</code>, contador acumulado da JVM, pela diferença entre as últimas amostras de aquecimento e medição, um intervalo aproximado registrado em app_cpu_window_seconds — não da mediana de <code>docker stats</code>, que também continua disponível como <code>app_cpu_percent_per_1000_rps</code>. Pausas de GC seguem a mesma regra; app_gc_window_seconds registra o intervalo observado. Esses intervalos podem incluir tempo fora dos 90 s de carga. MAX é um máximo em janela deslizante, não um máximo exato da rodada. A memória sem filtro agrega heap e non-heap; app_pool_pending_capacity é capacidade configurada, não ocupação observada. <code>app_pool_timeouts</code> é contador e, ao contrário do gauge de conexões pendentes, não escapa entre amostras. Métrica indisponível aparece vazia e não equivale a zero.</p><p>Erros e descartes são contagens, disponíveis por rodada no CSV. Uma rodada não executada não equivale a zero erros. Os arquivos quality.json de cada rodada mostram variação temporal e exclusões de amostra; status.json lista pendências. Três repetições são uma amostra pequena e não autorizam alegações de superioridade universal.</p></section></html>`;
  await writeFile(join(out,'index.html'),html);
  try{await catalog(resolve(batch,'..'));}catch(e){console.warn(`Relatório salvo; central de gráficos não atualizada: ${e.message}`);}
  return out;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{if(!process.argv[2])throw Error('Informe a pasta do lote.');console.log(await report(resolve(process.argv[2])));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
