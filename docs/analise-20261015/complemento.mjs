import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

// Análise documental: não executa cargas nem altera arquivos do lote.
const out=dirname(fileURLToPath(import.meta.url));
const root=resolve(out,'../..');
const batch='20261015-011234-1ceec5';
const base=join(root,'results',batch);
const read=async p=>(await readFile(p,'utf8')).replace(/^\uFEFF/,'');
const json=async p=>JSON.parse(await read(p));
const median=a=>{const s=[...a].sort((a,b)=>a-b);return (s[Math.floor((s.length-1)/2)]+s[Math.ceil((s.length-1)/2)])/2;};
const quantile=(a,p)=>{const s=[...a].sort((a,b)=>a-b);return s[Math.max(0,Math.ceil(p*s.length)-1)];};
const indices=[];
for(let a=0;a<3;a++)for(let b=0;b<3;b++)for(let c=0;c<3;c++)indices.push([a,b,c]);
function bootstrap(a,b){
  assert.equal(a.length,3);assert.equal(b.length,3);
  assert.ok([...a,...b].every(Number.isFinite));
  const stat=(i,j)=>median(i.map(k=>a[k]))-median(j.map(k=>b[k]));
  const paired=indices.map(i=>stat(i,i));
  const independent=indices.flatMap(i=>indices.map(j=>stat(i,j)));
  const interval=x=>[quantile(x,.025),quantile(x,.975)];
  return {difference:median(a)-median(b),paired_interval:interval(paired),independent_interval:interval(independent)};
}
// Casos conhecidos, enumeração completa e simetria ao inverter os braços.
assert.equal(indices.length,27);
assert.deepEqual(bootstrap([4,4,4],[1,1,1]),{difference:3,paired_interval:[3,3],independent_interval:[3,3]});
assert.deepEqual(bootstrap([1,2,3],[1,2,3]).paired_interval,[0,0]);
const check=bootstrap([2,5,11],[1,3,7]), reversed=bootstrap([1,3,7],[2,5,11]);
assert.equal(check.difference,-reversed.difference);
assert.deepEqual(check.independent_interval,reversed.independent_interval.map(x=>-x).reverse());

const names=(await readdir(base)).filter(n=>/^\d{3}-/.test(n)).sort();
const rows=[],warmup=[],images=new Map(),sources=[];
for(const name of names){
  const folder=join(base,name), row=await json(join(folder,'result.json'));
  const q=await json(join(folder,'quality.json'));
  assert.equal(row.analysis_status,'ok');assert.equal(q.integrity.counts_match,true);
  assert.equal(row.requests,q.integrity.latency_samples);
  assert.equal(row.timing_revision,'monotonic-anchor-v1');assert.equal(row.protocol_version,4);
  rows.push(row);
  const w=await json(join(folder,'warmup','row.json'));
  warmup.push({run:name,variant:w.variant,rate:w.offered_rps,requests:w.requests,correct:w.successful_requests,failures:w.requests-w.successful_requests,dropped:w.dropped_iterations,plateau_requests:w.plateau_requests,plateau_correct:w.plateau_successful_requests});
  for(const filename of ['containers.json','generator.json']){
    const captured=await json(join(folder,filename));
    for(const c of Array.isArray(captured)?captured:[captured]){
      const env=Object.fromEntries((c.Config.Env??[]).map(s=>{const p=s.indexOf('=');return [s.slice(0,p),s.slice(p+1)];}));
      const entry={service:c.Config.Labels?.['com.docker.compose.service']??'k6',tag:c.Config.Image,image_id:c.Image,manifest_digest:c.ImageManifestDescriptor?.digest??null,cpus:c.HostConfig.NanoCpus/1e9,memory_mib:c.HostConfig.Memory/2**20,cpuset:c.HostConfig.CpusetCpus||'sem afinidade explícita',java_version:env.JAVA_VERSION??null,jvm_flags:env.JAVA_TOOL_OPTIONS??null,db_pool:env.DB_POOL_SIZE??null,http_pool:env.HTTP_POOL_SIZE??null,source:`results/${batch}/${name}/${filename}`};
      const key=JSON.stringify({...entry,source:undefined});
      if(!images.has(key))images.set(key,entry);
    }
  }
}
assert.equal(rows.length,72);
const sum=(a,k)=>a.reduce((s,r)=>s+r[k],0);
const totals={planned:sum(rows,'expected_requests'),observed:sum(rows,'requests'),correct:sum(rows,'successful_requests'),warmup_failures:sum(warmup,'failures'),measurement_drops:sum(rows,'dropped_iterations'),excluded_samples:sum(rows,'excluded_samples'),temporal_alerts:rows.filter(r=>r.stability_status!=='sem_alerta').length};
assert.equal(totals.observed,totals.correct);
assert.equal(totals.warmup_failures,18);
assert.ok(warmup.filter(w=>w.failures>0).every(w=>w.variant==='mvc-feign'));
const comparisons=[];
for(const scenario of ['db-read','db-write','orders'])for(const rate of [200,500,1000]){
  const arms=scenario==='orders'?['mvc-resttemplate','mvc-feign','webflux']:['mvc-resttemplate','webflux'];
  for(let i=0;i<arms.length;i++)for(let j=i+1;j<arms.length;j++){
    const a=rows.filter(r=>r.scenario===scenario&&r.offered_rps===rate&&r.variant===arms[i]).sort((x,y)=>x.repetition-y.repetition);
    const b=rows.filter(r=>r.scenario===scenario&&r.offered_rps===rate&&r.variant===arms[j]).sort((x,y)=>x.repetition-y.repetition);
    assert.deepEqual(a.map(r=>r.repetition),[1,2,3]);assert.deepEqual(b.map(r=>r.repetition),[1,2,3]);
    for(const metric of ['latency_p95_ms','latency_p99_ms','successful_rps'])comparisons.push({scenario,rate,a:arms[i],b:arms[j],metric,a_values:a.map(r=>r[metric]),b_values:b.map(r=>r[metric]),a_runs:a.map(r=>r.run),b_runs:b.map(r=>r.run),...bootstrap(a.map(r=>r[metric]),b.map(r=>r[metric])),alerts:[...a,...b].filter(r=>r.stability_status!=='sem_alerta').length});
  }
}
assert.equal(comparisons.length,45);
const metadata=await json(join(base,'metadata.json')),info=await json(join(base,'docker-info.json')),version=await json(join(base,'docker-version.json'));
const hashText=await read(join(base,'source-hashes.csv'));
const poms=[];
for(const module of ['mvc-jdbc','webflux-r2dbc','stock-service']){
  const path=`${module}\\pom.xml`, bytes=await readFile(join(root,module,'pom.xml'));
  const sha=createHash('sha256').update(bytes).digest('hex').toUpperCase();
  const matches=hashText.split(/\r?\n/).some(line=>line===`"${path}","${sha}"`);
  const text=bytes.toString('utf8');
  poms.push({module,source_hash_matches:matches,boot:matches?text.match(/<parent>[\s\S]*?<version>([^<]+)/)?.[1]??null:null,cloud:matches?text.match(/<spring-cloud.version>([^<]+)/)?.[1]??null:null});
}
const environment={os:metadata.os,docker_desktop:version.Server.Platform.Name,docker_engine:version.Server.Version,compose:info.ClientInfo.Plugins.find(p=>p.Name==='compose')?.Version,kernel:info.KernelVersion,architecture:info.Architecture,docker_logical_cpus:info.NCPU,docker_memory_gib:info.MemTotal/2**30,physical_cpu_model:'não registrado no lote',physical_host_ram:'não registrada separadamente; MemTotal é a memória disponível ao Docker',power_plan:metadata.powerPlan,k6:metadata.k6Version,timing_revision:metadata.timingRevision,seconds:metadata.seconds,warmup_seconds:metadata.warmupSeconds,max_vus:metadata.maxVus,images:[...images.values()],poms};
const controls=[];
for(const id of ['20261005-010519-c1d0d5',batch]){
  const g=(await json(join(root,'results',id,'report','groups.json'))).filter(g=>g.scenario==='inventory');
  const v=g.map(g=>g.p95_median);
  controls.push({batch:id,values:g.map(g=>({rate:g.offered_rps,p95_median:g.p95_median})),range_ms:Math.max(...v)-Math.min(...v)});
}
const method={estimator:'mediana dos percentis por rodada de A menos mediana dos percentis por rodada de B; vazão usa a mesma diferença de medianas',unit:'rodada; n=3 por implementação e condição',primary_resampling:'blocos por repetition, 27 sequências equiprováveis com reposição; pressupõe blocos aproximadamente independentes e comparáveis',sensitivity:'reamostragem independente entre braços, 729 pares equiprováveis',interval:'percentil nominal 95%, quantil pela inversa da distribuição empírica; enumeração completa, sem erro Monte Carlo',limits:'Exploratório e pós-coleta. n=3 não permite assegurar cobertura de 95%. As três repetições são sequenciais na mesma máquina, não replicações em máquinas ou dias independentes. Sem correção para múltiplas comparações. Não usar exclusão de zero como teste confirmatório. Requisições individuais não contam como repetições independentes. Alertas e rodada de carga incompleta foram preservados e identificados.'};
const result={batch,totals,method,comparisons,environment,controls,warmup,measurement_exceptions:rows.filter(r=>!r.load_delivered).map(r=>({run:r.run,expected:r.expected_requests,observed:r.requests,correct:r.successful_requests,dropped:r.dropped_iterations})),sources:['metadata.json','docker-info.json','docker-version.json','source-hashes.csv','*/result.json','*/quality.json','*/warmup/row.json','*/containers.json','*/generator.json'].map(p=>`results/${batch}/${p}`)};
await mkdir(out,{recursive:true});
await writeFile(join(out,'analise.json'),JSON.stringify(result,null,2)+'\n');
const esc=s=>String(s??'não registrado').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const fmt=n=>Number(n).toLocaleString('pt-BR',{maximumFractionDigits:3});
const table=(headers,rs)=>`<div class="table"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rs.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const ci=v=>`[${fmt(v[0])}; ${fmt(v[1])}]`;
const html=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Complemento da análise — 15 de outubro de 2026</title><style>body{font:16px/1.6 system-ui,sans-serif;color:#172c3c;background:#f4f6f8;margin:0}main{max-width:1150px;margin:auto;padding:36px 24px;background:white}h1{font-size:30px}h2{margin-top:38px}p{max-width:95ch}.table{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #dce2e8;overflow-wrap:anywhere}th{background:#eaf0f4}code{overflow-wrap:anywhere}.note{border-left:4px solid #bc7b14;padding:12px 18px;background:#fff8e8}a{color:#135b87}</style><main>
<h1>Ambiente e diferenças entre implementações</h1><p>Lote ${batch}. Complemento para o artigo, elaborado a partir dos registros preservados. Não houve nova coleta nem alteração dos dados brutos.</p>
<h2>Contagem e aquecimento</h2>${table(['Indicador','Resultado'],Object.entries(totals).map(([k,v])=>[({planned:'Programadas',observed:'Observadas na medição',correct:'Corretas na medição',warmup_failures:'Falhas no aquecimento',measurement_drops:'Descartes na medição',excluded_samples:'Amostras excluídas',temporal_alerts:'Rodadas com alerta temporal'})[k],fmt(v)]))}
<p>A diferença zero é entre observadas e corretas. O total observado excedeu o programado em ${fmt(totals.observed-totals.planned)} requisições. Uma rodada registrou 89.998 de 90.000 previstas. Totais agregados não substituem a conferência de cada rodada.</p>
${table(['Feign: carga (req/s)','Falhas no aquecimento','Rodadas afetadas','Requisições no aquecimento'],[200,500,1000].map(rate=>{const w=warmup.filter(w=>w.variant==='mvc-feign'&&w.rate===rate);return [rate,sum(w,'failures'),w.filter(w=>w.failures).length,sum(w,'requests')];}))}
<p>As 18 falhas se concentraram em 7 das 9 rodadas do Feign. Isso é uma associação observada nesta implementação/configuração. O resumo de aquecimento não registra o instante e a causa de cada falha; portanto não prova que ocorreram nas primeiras chamadas. Os 3,67 milhões são o total da medição de todos os cenários, incluindo o próprio Feign, e não o denominador do aquecimento das outras duas implementações.</p>
<h2>Diferenças e incerteza exploratória</h2><p class="note">Três repetições por condição. Os intervalos abaixo são percentis bootstrap nominais de 95%, exploratórios. A cobertura real não foi estabelecida. Um intervalo que não cruza zero não basta para declarar superioridade geral ou significância confirmatória.</p>
<p>Estimador: mediana dos p95 por rodada de A menos a de B, em ms. Valores negativos indicam menor latência em A. Enumeramos as 27 reamostragens possíveis dos três blocos de repetição, preservando os braços do bloco. Como sensibilidade, enumeramos 729 combinações com reamostragem independente dos braços. Não há sorteio nem erro Monte Carlo. Os blocos não foram simultâneos; o pareamento supõe condições comparáveis dentro de cada bloco. Mantivemos alertas e a rodada com duas requisições a menos. Não há ajuste por múltiplas comparações. P99 e vazão também estão no arquivo analise.json.</p>
${table(['Cenário','req/s','A − B','Diferença p95 (ms)','Intervalo por blocos','Intervalo independente','Alertas (0–6)'],comparisons.filter(c=>c.metric==='latency_p95_ms').map(c=>[c.scenario,c.rate,c.a+' − '+c.b,fmt(c.difference),ci(c.paired_interval),ci(c.independent_interval),c.alerts]))}
<p>O bootstrap reusa as rodadas existentes; milhões de requisições não ampliam n de 3 para milhões. A análise é pós-coleta. A base teórica e as limitações de intervalos percentis em amostras pequenas são discutidas em <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC4784504/">Hesterberg (2015), What Teachers Should Know About the Bootstrap</a>.</p>
<h2>Ambiente registrado no lote</h2>${table(['Item','Valor','Evidência'],[['Sistema do host',environment.os,'metadata.json'],['Docker Desktop / Engine',environment.docker_desktop+' / '+environment.docker_engine,'docker-version.json'],['Compose',environment.compose,'docker-info.json'],['Kernel / arquitetura',environment.kernel+' / '+environment.architecture,'docker-info.json'],['CPUs lógicas / RAM disponíveis ao Docker',environment.docker_logical_cpus+' / '+fmt(environment.docker_memory_gib)+' GiB','docker-info.json; não é um inventário físico do host'],['Modelo físico de CPU e RAM instalada','Não registrados no lote','Não inferidos retrospectivamente'],['Energia',environment.power_plan,'metadata.json; plano do lote antigo não registrado'],['Gerador',environment.k6,'metadata.json e k6-version.txt'],['Relógio',environment.timing_revision,'72 result.json'],['Aquecimento / medição',environment.warmup_seconds+' s em rampa com platô / '+environment.seconds+' s constantes','metadata.json e row.json'],['Carga / repetições / VUs máximos','200, 500 e 1000 req/s; 3 repetições; '+environment.max_vus+' VUs','result.json'],...poms.map(p=>[p.module+' versões declaradas',p.source_hash_matches?'Spring Boot '+p.boot+(p.cloud?'; Spring Cloud BOM '+p.cloud:''):'POM atual não confere com hash do lote','POM verificado contra source-hashes.csv; não é inventário de todas as dependências transitivas'])])}
${table(['Serviço','CPU (cota)','Memória (MiB)','JVM / flags','Afinidade'],environment.images.map(e=>[e.service,e.cpus,e.memory_mib,(e.java_version??'—')+' '+(e.jvm_flags??''),e.cpuset]))}
<p>As aplicações comparadas usam G1 explicitamente e heap de 512 MiB. O serviço de estoque mantém sua própria configuração, comum aos braços. Configurações foram extraídas dos containers efetivamente registrados, e não apenas do Compose atual.</p>
<details><summary>Identidade das imagens e arquivos de origem</summary>${table(['Serviço e tag','Manifest digest','Image ID (config digest)','Fonte'],environment.images.map(e=>[e.service+' / '+e.tag,e.manifest_digest,e.image_id,e.source]))}<p>Manifest digest e Image ID são identificadores diferentes. Uma imagem local identificada não está necessariamente publicada ou disponível para download.</p></details>
<h2>Comparação histórica do controle</h2>${table(['Lote','p95 a 200','p95 a 500','p95 a 1000','Amplitude entre taxas (ms)'],controls.map(c=>[c.batch,...c.values.sort((a,b)=>a.rate-b.rate).map(v=>fmt(v.p95_median)),fmt(c.range_ms)]))}
<p>A amplitude entre taxas passou de aproximadamente 0,955 para 0,146 ms. Essa amplitude descreve sensibilidade à taxa neste controle; não estima diretamente o piso de ruído, que requer repetições sob a mesma condição. Os protocolos diferem. A comparação histórica não identifica o efeito causal de GC, heap, energia, aquecimento ou exportação de amostras. A revisão do relógio corrige a medição; não houve experimento isolado para quantificar seu impacto no custo do gerador ou na vazão observada.</p>
<h2>Texto sugerido para os resultados</h2><p>Durante a medição, foram registradas 3.672.051 requisições, todas classificadas como corretas pelos validadores do experimento, frente a 3.672.000 requisições programadas. Não foram registrados descartes de iterações ou exclusões de amostras de latência. No aquecimento, foram observadas 18 falhas, concentradas em sete das nove rodadas da configuração Spring MVC/JDBC com OpenFeign: uma a 200 req/s, seis a 500 req/s e onze a 1.000 req/s. A causa dessas falhas não foi isolada. As comparações de latência foram feitas por condição, com três repetições, e os intervalos bootstrap são apresentados como análise exploratória, considerando a pequena quantidade de repetições e os nove alertas de variação temporal.</p>
<p>Dados e método completos: <a href="analise.json">analise.json</a>. Script reproduzível: complemento.mjs. Fontes: pasta results/${batch}; comparação histórica: results/20261005-010519-c1d0d5/report/groups.json. Os resultados históricos não foram combinados com os atuais.</p></main></html>`;
await writeFile(join(out,'complemento-artigo.html'),html);
console.log(JSON.stringify({totals,comparisons:comparisons.length,environmentConfigurations:images.size,poms,orders1000:comparisons.filter(c=>c.scenario==='orders'&&c.rate===1000&&c.metric==='latency_p95_ms'),output:join(out,'complemento-artigo.html')},null,2));
