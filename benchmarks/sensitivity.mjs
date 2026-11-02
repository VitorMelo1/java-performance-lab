import {createReadStream} from 'node:fs';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {evaluateStability} from './quality.mjs';
import {addWarmup,aggregate} from './report.mjs';

// Post-hoc sensitivity analysis only. The strict protocol-3 report remains unchanged.
const maxNegativeCount=10;
const maxNegativeFraction=0.001;

function percentile(values,fraction) {
  const sorted=[...values].sort((a,b)=>a-b);
  if(!sorted.length) return null;
  const position=(sorted.length-1)*fraction;
  const low=Math.floor(position);
  return sorted[low]+(sorted[Math.ceil(position)]-sorted[low])*(position-low);
}

function csv(rows) {
  if(!rows.length) return '';
  const keys=Object.keys(rows[0]);
  return keys.join(',')+'\n'+rows.map(row=>keys.map(key=>'"'+String(row[key]??'').replaceAll('"','""')+'"').join(',')).join('\n')+'\n';
}

async function json(path) {
  return JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
}

/** Recalculate duration statistics only when sparse impossible native samples are confirmed. */
export async function reviewAnomalousRun(folder,row) {
  if(row.protocol_version!==3 || !Number.isSafeInteger(row.requests) || row.requests<=0 ||
      !Number.isFinite(row.scheduled_seconds) || row.scheduled_seconds<=0 ||
      !Number.isFinite(row.elapsed_seconds) || row.elapsed_seconds<=0 ||
      row.elapsed_seconds>row.scheduled_seconds+30) {
    throw Error('Metadados da rodada inválidos para análise de sensibilidade.');
  }
  let rawHttpRequests=0,latencySamples=0,nativeSamples=0,lineNumber=0;
  const validPoints=[],negative=[],nativeNegative=[];
  const input=createReadStream(join(folder,'samples.json.gz')).pipe(createGunzip());
  const reader=createInterface({input,crlfDelay:Infinity});
  for await(const line of reader) {
    lineNumber++;
    if(!line.trim()) continue;
    let entry;
    try {entry=JSON.parse(lineNumber===1?line.replace(/^\uFEFF/,''):line);}
    catch {throw Error(`JSON bruto inválido na linha ${lineNumber}.`);}
    if(entry.type!=='Point') continue;
    const value=entry.data?.value;
    if(entry.metric==='http_reqs') {
      if(!Number.isSafeInteger(value)||value<0) throw Error(`Contagem HTTP inválida na linha ${lineNumber}.`);
      rawHttpRequests+=value;
    } else if(entry.metric==='request_latency_ms') {
      latencySamples++;
      const time=Date.parse(entry.data?.time);
      if(!Number.isFinite(time)||!Number.isFinite(value)) throw Error(`Amostra inválida na linha ${lineNumber}.`);
      if(value<0) negative.push({line:lineNumber,value,time:entry.data.time});
      else validPoints.push({time,value});
    } else if(entry.metric==='http_req_duration') {
      nativeSamples++;
      if(!Number.isFinite(value)) throw Error(`Métrica nativa inválida na linha ${lineNumber}.`);
      if(value<0) nativeNegative.push(value);
    }
  }
  if(rawHttpRequests!==row.requests || latencySamples!==row.requests || nativeSamples!==row.requests) {
    throw Error('Contagens de requisições e durações não conferem com row.json.');
  }
  if(!negative.length) throw Error('Nenhuma duração negativa encontrada; a falha original requer outra investigação.');
  const fraction=negative.length/row.requests;
  if(negative.length>maxNegativeCount || fraction>maxNegativeFraction) {
    throw Error(`Amostras negativas acima do limite de sensibilidade (10 e 0,1%): ${negative.length}/${row.requests}.`);
  }
  const customValues=negative.map(x=>x.value).sort((a,b)=>a-b);
  nativeNegative.sort((a,b)=>a-b);
  if(customValues.length!==nativeNegative.length || customValues.some((x,i)=>x!==nativeNegative[i])) {
    throw Error('A métrica nativa http_req_duration não confirma as durações negativas.');
  }
  const values=validPoints.map(x=>x.value);
  const stability=evaluateStability(validPoints,row.scheduled_seconds);
  return {
    total_samples:latencySamples,valid_samples:values.length,negative_samples:negative.length,
    negative_fraction:fraction,raw_http_requests:rawHttpRequests,negative_details:negative,
    latency_p50_ms:percentile(values,0.5),latency_p95_ms:percentile(values,0.95),
    latency_p99_ms:percentile(values,0.99),latency_mean_ms:values.reduce((sum,x)=>sum+x,0)/values.length,
    stability_status:stability.status,
  };
}

/** Writes derived files in batch/sensitivity; never changes raw samples or primary results. */
export async function sensitivityReport(batch) {
  const status=await json(join(batch,'status.json'));
  const metadata=await json(join(batch,'metadata.json'));
  if(status.protocol!==3 || metadata.protocolVersion!==3 || status.state!=='complete') {
    throw Error('Análise de sensibilidade exige lote completo do protocolo 3.');
  }
  const primary=[],supplemental=[],table=[];
  const entries=(await readdir(batch,{withFileTypes:true}))
    .filter(x=>x.isDirectory()&&/^\d{3}-/.test(x.name)).sort((a,b)=>a.name.localeCompare(b.name));
  if(entries.length!==status.completed) throw Error('Número de pastas não confere com status.json.');
  for(const entry of entries) {
    const folder=join(batch,entry.name);
    const row=await json(join(folder,'result.json'));
    if(row.protocol_version!==3 || row.run!==entry.name) throw Error(`Rodada incompatível: ${entry.name}.`);
    await addWarmup(row,folder);
    if(row.analysis_status==='ok') {
      primary.push(row);
      table.push({run:row.run,scenario:row.scenario,variant:row.variant,offered_rps:row.offered_rps,
        repetition:row.repetition,primary_status:'ok',sensitivity_status:'original',
        negative_samples:0,requests:row.requests,native_p95_ms:row.latency_p95_ms,
        filtered_p95_ms:row.latency_p95_ms,native_p99_ms:row.latency_p99_ms,
        filtered_p99_ms:row.latency_p99_ms});
      continue;
    }
    if(row.analysis_status!=='invalid') throw Error(`Estado de análise inesperado: ${entry.name}.`);
    const review=await reviewAnomalousRun(folder,row);
    const corrected={...row,analysis_status:'ok',sensitivity_only:true,
      latency_p50_ms:review.latency_p50_ms,latency_p95_ms:review.latency_p95_ms,
      latency_p99_ms:review.latency_p99_ms,latency_mean_ms:review.latency_mean_ms,
      stability_status:review.stability_status};
    supplemental.push({row:corrected,review});
    table.push({run:row.run,scenario:row.scenario,variant:row.variant,offered_rps:row.offered_rps,
      repetition:row.repetition,primary_status:'invalid',sensitivity_status:'posthoc_negative_exclusion',
      negative_samples:review.negative_samples,requests:row.requests,native_p95_ms:row.latency_p95_ms,
      filtered_p95_ms:review.latency_p95_ms,native_p99_ms:row.latency_p99_ms,
      filtered_p99_ms:review.latency_p99_ms});
  }
  const negativeSamples=supplemental.reduce((n,x)=>n+x.review.negative_samples,0);
  const groups=aggregate([...primary,...supplemental.map(x=>x.row)]);
  const output=join(batch,'sensitivity');
  await mkdir(output,{recursive:true});
  await writeFile(join(output,'rounds.csv'),csv(table));
  await writeFile(join(output,'groups.csv'),csv(groups));
  await writeFile(join(output,'negative-samples.json'),JSON.stringify(supplemental.map(x=>({run:x.row.run,
    samples:x.review.negative_details})),null,2)+'\n');
  const maxP95Change=Math.max(0,...table.map(x=>Math.abs(x.filtered_p95_ms-x.native_p95_ms)));
  const summary={batch,kind:'posthoc_sensitivity_not_primary',primary_accepted:primary.length,
    supplemental_accepted:supplemental.length,total_analyzable:primary.length+supplemental.length,
    negative_samples:negativeSamples,max_negative_per_run:maxNegativeCount,
    max_negative_fraction_per_run:maxNegativeFraction,max_p95_change_ms:maxP95Change,
    raw_data_modified:false};
  await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');
  await writeFile(join(output,'LEIA-ME.md'),
    `# Análise de sensibilidade posterior à coleta\n\n`+
    `A análise primária do protocolo 3 permanece em \`../report/\`: ${primary.length} rodadas aceitas e ${supplemental.length} excluídas. `+
    `Esta análise secundária considera ${summary.total_analyzable} rodadas após retirar ${negativeSamples} durações negativas de `+
    `requisições individuais, confirmadas também em \`http_req_duration\`. Nenhum arquivo bruto, \`row.json\` ou \`result.json\` foi modificado.\n\n`+
    `A regra secundária aceita somente amostras negativas finitas, com no máximo ${maxNegativeCount} por rodada e `+
    `no máximo 0,1% das requisições; qualquer outra inconsistência continua rejeitada. Os percentis de ${supplemental.length} ${supplemental.length===1?'rodada':'rodadas'} `+
    `afetadas foram recalculados a partir das durações não negativas. Esta regra foi definida **após observar o lote** e `+
    `não transforma os resultados em uma repetição independente ou em validação do protocolo original. `+
    `O maior deslocamento de p95 frente ao resumo nativo foi ${maxP95Change.toFixed(6)} ms.\n\n`+
    `Veja \`negative-samples.json\` para cada exclusão, \`rounds.csv\` para os percentis antes/depois e `+
    `\`groups.csv\` para as medianas por condição. Ao escrever o artigo, apresente a análise primária e esta `+
    `sensibilidade separadamente. A causa do tempo negativo no gerador não foi estabelecida.\n`);
  return {output,summary};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    if(process.argv.length!==3) throw Error('Uso: node benchmarks/sensitivity.mjs "pasta do lote"');
    const {output,summary}=await sensitivityReport(resolve(process.argv[2]));
    console.log(JSON.stringify({output,summary},null,2));
  } catch(error) {
    console.error(error.message);
    process.exitCode=1;
  }
}
