import {readFile,writeFile,readdir,mkdir,mkdtemp} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {aggregate,report,serverWindow} from './report.snapshot.mjs';

const auditDir=dirname(fileURLToPath(import.meta.url)),root=resolve(auditDir,'../..');
const batch=join(root,'results/20261015-011234-1ceec5');
const read=async p=>(await readFile(p,'utf8')).replace(/^\uFEFF/,'');
const json=async p=>JSON.parse(await read(p));
const median=vs=>{const a=vs.slice().sort((a,b)=>a-b);return (a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2;};
const close=(a,b)=>Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
const checks=[];
const check=(name,expected,actual,passed,evidence)=>checks.push({name,expected,actual,passed,evidence});
const rows=[],quality=[],sourceHashes=[];
for(const name of (await readdir(batch)).filter(n=>/^\d{3}-/.test(n)).sort()){
 const folder=join(batch,name),r=await json(join(folder,'result.json')),q=await json(join(folder,'quality.json')),raw=await json(join(folder,'row.json'));
 rows.push(r);quality.push(q);
 for(const [key,metric] of [['latency_p50_ms','p50_ms'],['latency_p95_ms','p95_ms'],['latency_p99_ms','p99_ms']]){
  assert.ok(close(r[key],q.latency[metric]),name+': divergencia result/quality');
  assert.ok(close(r[key],raw[key]),name+': divergencia result/resumo k6');
 }
 assert.equal(r.requests,q.integrity.latency_samples);
 assert.equal(r.requests,q.integrity.raw_http_requests);
 assert.equal(r.requests,q.integrity.native_duration_samples);
 assert.ok(close(r.successful_rps,r.successful_requests/r.elapsed_seconds));
}
check('p50/p95/p99 e vazao: 72 rodadas','result.json, quality.json e resumo do k6 coerentes','216 percentis e 72 vazoes conferidos',true,'Arquivos pequenos preservados; nao houve releitura de samples.json.gz nesta auditoria.');
const groups=await json(join(batch,'report/groups.json'));
for(const g of groups){
 const rs=rows.filter(r=>r.scenario===g.scenario&&r.variant===g.variant&&r.offered_rps===g.offered_rps&&r.analysis_status==='ok');
 for(const [key,metric] of [['p95_median','latency_p95_ms'],['p99_median','latency_p99_ms'],['successful_rps_median','successful_rps']])assert.ok(close(g[key],median(rs.map(r=>r[metric]))),key);
 assert.equal(g.n,rs.length);
}
let geometry=0,zeroBars=0;
for(const scenario of [...new Set(groups.map(g=>g.scenario))]){
 const gs=groups.filter(g=>g.scenario===scenario),svg=await read(join(batch,'report',`latencia-p95-${scenario}.svg`));
 const rects=[...svg.matchAll(/<rect x="395" y="([^"]+)" width="([^"]+)"/g)];
 const circles=[...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)"/g)];
 assert.equal(rects.length,gs.length);
 const max=Math.max(1,...gs.map(g=>g.p95_max));
 for(let i=0;i<gs.length;i++){
  assert.ok(close(Number(rects[i][2]),610*gs[i].p95_median/max));
  const own=rows.filter(r=>r.scenario===scenario&&r.variant===gs[i].variant&&r.offered_rps===gs[i].offered_rps);
  const points=circles.filter(c=>Number(c[2])===91+i*42).map(c=>Number(c[1])).sort((a,b)=>a-b);
  const expected=own.map(r=>395+610*r.latency_p95_ms/max).sort((a,b)=>a-b);
  assert.equal(points.length,expected.length);points.forEach((v,k)=>assert.ok(close(v,expected[k])));geometry++;
 }
 for(const metric of ['falhas','descartes']){
  const zeroSvg=await read(join(batch,'report',`${metric}-${scenario}.svg`));
  zeroBars += [...zeroSvg.matchAll(/<rect x="395"[^>]*width="1"/g)].length;
 }
}
check('Geometria das barras e pontos de p95','larguras proporcionais e pontos nas posicoes das repeticoes',`${geometry} barras e 72 pontos corretos`,true,'SVGs originais e result.json, com calculo independente.');
check('Valor zero desenhado no grafico','largura zero para valor zero',`${zeroBars} barras de largura 1 px com contagem zero`,zeroBars===0,'Math.max(1, x(v)-left) em chart(). Os rotulos numericos continuam 0.00.');
const mismatch=rows.filter(r=>r.load_delivered===false&&aggregate([r])[0].load_delivered_repetitions===1);
check('Consistencia da carga entregue','mesmo criterio em quality.json e report',mismatch.map(r=>r.run),mismatch.length===0,'quality exige observado >= alvo-1; report aceita fracao >= 0.999. A rodada 057 tem 89998/90000.');

// Casos sinteticos, sem Docker, fora dos arquivos da coleta em andamento.
const fixture=await mkdtemp(join(auditDir,'fixture-')),run='001-webflux-orders-r500-rep1';
await mkdir(join(fixture,run,'warmup'),{recursive:true});
const row={protocol_version:4,timing_revision:'monotonic-anchor-v1',scenario:'orders',variant:'webflux',repetition:1,run,offered_rps:500,scheduled_seconds:90,elapsed_seconds:90,requests:45000,successful_requests:45000,successful_rps:500,dropped_iterations:0,delivered_fraction:1,load_delivered:true,analysis_status:'ok',latency_p95_ms:4,latency_p99_ms:7,stability_status:'sem_alerta'};
await writeFile(join(fixture,'metadata.json'),JSON.stringify({protocolVersion:4,quick:false}));
await writeFile(join(fixture,'status.json'),JSON.stringify({state:'complete',planned:1,completed:1}));
await writeFile(join(fixture,run,'result.json'),JSON.stringify(row));
await writeFile(join(fixture,run,'warmup/row.json'),JSON.stringify({requests:100,successful_requests:100,dropped_iterations:0}));
const sample=(cpu,gc)=>({timestamp:'2026-10-15T00:00:00Z',metrics:{
 'process.cpu.time':{baseUnit:'ns',measurements:[{statistic:'COUNT',value:cpu}]},
 'jvm.gc.pause':{baseUnit:'seconds',measurements:[{statistic:'COUNT',value:1},{statistic:'TOTAL_TIME',value:gc},{statistic:'MAX',value:gc}]},
 'jvm.memory.used':{baseUnit:'bytes',availableTags:[{tag:'area',values:['heap','nonheap']}],measurements:[{statistic:'VALUE',value:300}]},
 'r2dbc.pool.max.pending':{baseUnit:'connections',description:'Maximum size of pending state to acquire connections that this pool allows.',measurements:[{statistic:'VALUE',value:2147483647}]}
}});
await writeFile(join(fixture,run,'warmup/jvm.jsonl'),JSON.stringify(sample(1e9,.1))+'\n');
await writeFile(join(fixture,run,'jvm.jsonl'),JSON.stringify(sample(3e9,.3))+'\n');
await report(fixture);
const csv=(await read(join(fixture,'report/rounds.csv'))).trim().split(/\r?\n/);
const keys=csv[0].split(','),vals=csv[1].match(/"(?:[^"]|"")*"/g).map(v=>v.slice(1,-1).replaceAll('""','"'));
const record=Object.fromEntries(keys.map((k,i)=>[k,vals[i]]));
check('CPU: conversao ns para ms por resposta','2 segundos / 45000 respostas * 1000',Number(record.app_cpu_ms_per_request),close(Number(record.app_cpu_ms_per_request),2/45000*1000),'Fixture com contador de 1e9 para 3e9 ns. A unidade foi calculada corretamente.');
check('Memoria total rotulada como heap','heap indisponivel sem filtro por area',record.app_heap_used_bytes,!record.app_heap_used_bytes,'O campo recebe 300 bytes de heap+nonheap sem filtrar. Confirmado tambem nos registros reais.');
const absent=aggregate([row])[0];
check('Metrica de timeout ausente','null/indisponivel',absent.app_pool_timeouts,absent.app_pool_timeouts===null,'reduce inicia em zero e ignora ausencias. WebFlux nao tem contador Hikari; zero nao comprova ausencia de timeouts.');
const reset=serverWindow({buckets:new Map([[.001,10],[.01,20],[Infinity,30]]),count:30,sum:.2},{buckets:new Map([[.001,5],[.01,40],[Infinity,70]]),count:70,sum:.5});
check('Histograma com contador que diminuiu','janela rejeitada ou sinalizada como invalida',reset,reset===null||reset.invalid===true,'Uma queda de contador e truncada para zero; a funcao ainda produz p50 e media, em vez de rejeitar a janela. Caso sintetico, nao constatado no lote concluido.');
const before=await json(join(auditDir,'source-hashes-before.json'));
for(const source of before){const hash=createHash('sha256').update(await readFile(source.Path)).digest('hex').toUpperCase();assert.equal(hash,source.Hash,'Codigo ativo alterado');sourceHashes.push({path:source.Path,sha256:hash});}

// Examina os intervalos reais de amostragem; leitura apenas dos arquivos pequenos.
const spans=[];
for(const row of rows){
 const folder=join(batch,row.run),w=(await read(join(folder,'warmup/jvm.jsonl'))).trim().split('\n').map(JSON.parse),m=(await read(join(folder,'jvm.jsonl'))).trim().split('\n').map(JSON.parse);
 if(w.length&&m.length)spans.push({run:row.run,seconds:(Date.parse(m.at(-1).timestamp)-Date.parse(w.at(-1).timestamp))/1000,scheduled:row.scheduled_seconds});
}
const intervals={min:Math.min(...spans.map(s=>s.seconds)),max:Math.max(...spans.map(s=>s.seconds)),median:median(spans.map(s=>s.seconds))};
check('Janela de CPU/GC apresentada como exata','informar limites reais da amostragem, nao apenas a duracao k6',intervals,false,'A subtracao usa a ultima amostra do aquecimento e a ultima da medicao. Intervalos nao coincidem exatamente com a carga de 90 s. Isso nao invalida p95 HTTP, mas exige corrigir/qualificar CPU e GC.');
const findings={scope:'Auditoria de relatorio, unidades, agregacao e SVG. Lote 20261015-011234-1ceec5. Nenhum benchmark iniciado. Sem reprocessamento completo de samples.json.gz enquanto ha carga em andamento.',checks,sourceHashes,intervals:spans,fixture};
await writeFile(join(auditDir,'audit-results.json'),JSON.stringify(findings,null,2)+'\n');
const e=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');
await writeFile(join(auditDir,'auditoria.html'),`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Auditoria dos gráficos</title><style>body{font:16px/1.6 system-ui;max-width:1050px;margin:40px auto;padding:0 24px;color:#243543}table{border-collapse:collapse;width:100%}td,th{padding:12px;border-bottom:1px solid #ccc;text-align:left;vertical-align:top}pre{white-space:pre-wrap}p{max-width:85ch}</style><h1>Auditoria dos gráficos — 20/10/2026</h1><p>${e(findings.scope)}</p><p>As medianas e os pontos de p95 conferem com os arquivos por rodada. A auditoria mais ampla encontrou inconsistências de apresentação e de métricas auxiliares. A validação não promete ausência de todos os bugs.</p><table><thead><tr><th>Verificação</th><th>Resultado</th><th>Evidência</th></tr></thead><tbody>${checks.map(c=>`<tr><td>${e(c.name)}</td><td>${c.passed?'Conferido':'Problema reproduzido'}<pre>${e(JSON.stringify(c.actual,null,2))}</pre></td><td>${e(c.evidence)}</td></tr>`).join('')}</tbody></table><h2>Outras observações de interpretação</h2><ul><li>r2dbc.pool.max.pending é capacidade configurada da fila (2.147.483.647), não pico observado de requisições esperando. O campo app_pool_max_pending deve ser renomeado e a ocupação observada deve vir de r2dbc.pool.pending.</li><li>O texto que atribui todo n menor que 3 a exclusões é incorreto: a sessão B planeja somente duas repetições.</li><li>Sem scrape inicial, o p95 do servidor é cumulativo; a agregação não preserva essa distinção e o gráfico pode chamá-lo de janela medida. No lote concluído há scrapes iniciais.</li><li>Os percentis de histograma do servidor são estimativas por interpolação em baldes. Diferenças contra o k6 não identificam sozinhas custo de rede ou do gerador.</li></ul><h2>Aplicação das correções</h2><p>O código usado pela coleta em andamento foi preservado e os hashes conferidos. Os defeitos de relatório podem ser corrigidos depois e os gráficos regenerados sem repetir a carga. CPU/GC exigem declarar corretamente o intervalo observado ou usar os scrapes de fronteira já salvos; não inventar amostras ausentes. Não reavaliar os dados brutos pesados enquanto a máquina mede desempenho.</p><p>Detalhes reproduzíveis em audit-results.json e audit.mjs; implementação auditada em report.snapshot.mjs. Os casos sintéticos ficam em uma pasta fixture dentro desta auditoria.</p></html>`);
console.log(JSON.stringify({passed:checks.filter(c=>c.passed).length,problems:checks.filter(c=>!c.passed).map(c=>({name:c.name,actual:c.actual})),codeUnchanged:true,output:join(auditDir,'auditoria.html')},null,2));
