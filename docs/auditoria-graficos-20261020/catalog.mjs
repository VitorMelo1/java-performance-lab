import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const escape=v=>String(v??'—').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const number=v=>Number.isFinite(v)?v.toLocaleString('pt-BR',{minimumFractionDigits:3,maximumFractionDigits:3}):'—';
const read=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
const optional=async p=>{try{return await read(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const titles={'orders':'Pedidos entre serviços','db-read':'Leitura no banco','db-write':'Escrita no banco','inventory':'Controle do estoque','http':'Chamada HTTP','upstream':'Controle HTTP'};
const arms={'mvc-resttemplate':'MVC / JDBC / RestTemplate','mvc-feign':'MVC / JDBC / Feign','webflux':'WebFlux / R2DBC / WebClient','inventory':'Serviço de estoque'};
const css=`:root{color-scheme:light;--ink:#233b38;--accent:#28665a;--paper:#f5f2e9}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.6 'Segoe UI',sans-serif}main{max-width:1180px;margin:auto;padding:36px 28px}h1{font-size:clamp(30px,4vw,44px);line-height:1.15;font-weight:650;letter-spacing:-1px}h2{font-size:26px;margin-top:40px}p{max-width:78ch}a{color:#195e78;text-underline-offset:4px}a:focus-visible,summary:focus-visible{outline:3px solid #a45d17;outline-offset:4px}.button{display:inline-block;padding:12px 20px;background:var(--accent);color:white;text-decoration:none;border-radius:6px;margin:8px 8px 8px 0}.feature{padding:24px;background:#fff;border-left:6px solid var(--accent);border-radius:0 12px 12px 0}.muted{color:#596b66;font-size:15px}.note{padding:14px 20px;background:#f2e6cd;border-radius:8px}nav{display:flex;flex-wrap:wrap;gap:10px 24px;margin:24px 0}section{scroll-margin-top:20px}.table{overflow:auto;margin:18px 0}table{width:100%;border-collapse:collapse;font-size:15px;font-variant-numeric:tabular-nums}th,td{padding:12px;text-align:left;border-bottom:1px solid #cad1c9}th{background:#e5ebe3}td{background:#fff}details{margin:18px 0}summary{cursor:pointer;font-weight:600;padding:10px 0}figure{margin:22px 0;background:#fff;padding:14px;border-radius:10px}figure img{display:block;width:100%;height:auto}figcaption{font-size:14px;color:#596b66}.id{overflow-wrap:anywhere}footer{margin-top:40px;font-size:14px} @media(max-width:600px){main{padding:20px 14px}.feature{padding:18px}table{min-width:650px}}`;
const page=(title,body)=>`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title><style>${css}</style></head><body><main>${body}<footer>Java Performance Lab · Resultados locais. Não combina protocolos ou sessões.</footer></main></body></html>`;
const table=(head,rows)=>`<div class="table"><table><thead><tr>${head.map(h=>`<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const figure=(files,prefix,scenario,label)=>{const name=`${prefix}-${scenario}.svg`;return files.has(name)?`<figure><img loading="lazy" src="${encodeURIComponent(name)}" alt="${escape(label)}: ${escape(titles[scenario]??scenario)}"><figcaption><a href="${encodeURIComponent(name)}">Abrir ${escape(label.toLowerCase())} em tamanho original</a></figcaption></figure>`:'';};
export async function catalog(root){
 const batches=[];
 for(const entry of await readdir(root,{withFileTypes:true})){
  if(!entry.isDirectory()||!/^\d{8}-\d{6}-[\da-f]+$/.test(entry.name))continue;
  const folder=join(root,entry.name),metadata=await optional(join(folder,'metadata.json')),status=await optional(join(folder,'status.json'));
  if(!metadata||!status)continue;
  let files;try{files=new Set(await readdir(join(folder,'report')));}catch(e){if(e.code==='ENOENT')files=new Set();else throw e;}
  const rows=[];
  for(const run of await readdir(folder,{withFileTypes:true}))if(run.isDirectory()&&/^\d{3}-/.test(run.name)){
   const row=await optional(join(folder,run.name,'result.json'));if(row)rows.push({...row,folder:run.name});
  }
  const batch={name:entry.name,metadata,status,rows,report:files.has('index.html')};batches.push(batch);
  if(!batch.report)continue;
  const scenarios=[...new Set(rows.map(r=>r.scenario))].sort();
  let body=`<a href="../../index.html">Todas as coletas</a><h1>Gráficos desta coleta</h1><p class="id">${escape(entry.name)}${metadata.session?' · '+escape(metadata.session):''}</p><p>${escape(status.completed)} de ${escape(status.planned)} rodadas concluídas. Protocolo ${escape(metadata.protocolVersion)}. Estado: ${escape(status.state)}.</p>`;
  if(metadata.quick||status.state!=='complete')body+='<p class="note">Ensaio curto ou coleta incompleta. Consulte as pendências antes de usar os resultados no artigo.</p>';
  body+=`<nav>${scenarios.map(s=>`<a href="#${escape(s)}">${escape(titles[s]??s)}</a>`).join('')}<a href="index.html">Relatório completo e ressalvas</a></nav>
  <details open><summary>Como ler sem confundir as métricas</summary><p><strong>p95:</strong> tempo em que 95% das requisições terminaram. Menor é melhor, desde que vazão, falhas e descartes sejam considerados. Na figura de p95, a barra mostra a mediana entre rodadas, os pontos mostram cada repetição e a linha mostra mínimo e máximo — não é um intervalo de confiança.</p><p><strong>Vazão:</strong> respostas corretas por segundo. Barras próximas do mesmo alvo são esperadas quando todas as aplicações atendem à carga programada. A escala e o arredondamento também podem fazer valores próximos parecerem iguais.</p><p><strong>Repetições:</strong> cada rodada reinicia a aplicação e tem seu próprio aquecimento. A terceira não precisa ser mais rápida que a segunda. Diferenças entre rodadas devem ser mostradas; alertas grandes precisam ser investigados, sem presumir uma causa.</p><p>Aquecimento e medição são fases diferentes. Incidentes do aquecimento aparecem no <a href="index.html">relatório completo</a>.</p></details>`;
  for(const scenario of scenarios){
   const own=rows.filter(r=>r.scenario===scenario).sort((a,b)=>a.offered_rps-b.offered_rps||a.variant.localeCompare(b.variant)||a.repetition-b.repetition);
   const cells=new Map();for(const row of own){const key=`${row.offered_rps}|${row.variant}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(row);}
   const reps=[...new Set(own.map(r=>r.repetition))].sort((a,b)=>a-b);
   body+=`<section id="${escape(scenario)}"><h2>${escape(titles[scenario]??scenario)}</h2>${figure(files,'latencia-p95',scenario,'Latência p95')}${figure(files,'vazao',scenario,'Vazão correta')}<h3>p95 em cada repetição, em milissegundos</h3>`;
   body+=table(['Carga (req/s)','Implementação',...reps.map(r=>`Repetição ${r}`),'Observações'],[...cells.values()].map(rs=>{
    const alerts=rs.filter(r=>r.stability_status&&r.stability_status!=='sem_alerta').length;
    const invalid=rs.filter(r=>r.analysis_status!=='ok').length;
    const missing=rs.filter(r=>r.load_delivered===false).length;
    return [escape(rs[0].offered_rps),escape(arms[rs[0].variant]??rs[0].variant),...reps.map(rep=>{const r=rs.find(r=>r.repetition===rep);return r?`<a href="../${encodeURIComponent(r.folder)}/result.json">${number(r.latency_p95_ms)}</a>${r.analysis_status!=='ok'?' (análise inválida)':''}`:'—';}),escape([alerts?`${alerts} alerta(s) temporal(is)`:'',invalid?`${invalid} análise(s) inválida(s)`:'',missing?`${missing} carga(s) incompleta(s)`:''].filter(Boolean).join('; ')||'Sem essas ressalvas')];
   }));
   body+='<details><summary>Ver p99, recursos, erros e descartes</summary>';
   for(const [prefix,label] of [['latencia-p99','Latência p99'],['cpu-por-requisicao','CPU por requisição'],['gc','Pausas de GC'],['falhas','Falhas'],['descartes','Descartes'],['entrega','Fração entregue']])body+=figure(files,prefix,scenario,label);
   body+='</details></section>';
  }
  await writeFile(join(folder,'report','navegar.html'),page('Gráficos por cenário',body));
 }
 batches.sort((a,b)=>b.name.localeCompare(a.name));
 const complete=batches.filter(b=>b.status.state==='complete'&&!b.metadata.quick&&b.report);
 const featured=complete.find(b=>b.metadata.timingRevision==='monotonic-anchor-v1')??complete[0];
 const link=b=>b.report?`<a href="${encodeURIComponent(b.name)}/report/navegar.html">${escape(b.name)}</a>`:escape(b.name)+' (sem relatório)';
 const listing=bs=>table(['Coleta','Sessão','Rodadas','Protocolo / relógio','Estado'],bs.map(b=>[link(b),escape(b.metadata.session||'—'),escape(`${b.status.completed}/${b.status.planned}`),escape(`${b.metadata.protocolVersion} / ${b.metadata.timingRevision||'relógio original'}`),escape(b.metadata.quick?'ensaio curto':b.status.state)]));
 let home='<h1>Seus gráficos, em um lugar</h1><p>Abra a coleta, escolha o cenário e compare as implementações. Os dados de cada execução continuam preservados em sua pasta.</p>';
 home+=featured?`<section class="feature"><h2>Coleta concluída mais recente com relatório</h2><p class="id">${escape(featured.name)} · ${escape(featured.status.completed)} rodadas${featured.metadata.session?' · '+escape(featured.metadata.session):''}</p><a class="button" href="${encodeURIComponent(featured.name)}/report/navegar.html">Abrir gráficos por cenário</a><a href="${encodeURIComponent(featured.name)}/report/index.html">Relatório completo</a></section>`:'<p>Nenhuma coleta completa com relatório disponível. Execute uma coleta e atualize esta página.</p>';
 home+='<h2>Coletas completas</h2>'+listing(complete);
 home+='<details><summary>Ensaios curtos e coletas incompletas</summary>'+listing(batches.filter(b=>!complete.includes(b)))+'</details>';
 home+='<p class="muted">A central é atualizada ao gerar um relatório. Se novos arquivos foram copiados manualmente, execute scripts/Atualizar-Graficos.ps1. No navegador, atualize a página após a coleta.</p>';
 await writeFile(join(root,'index.html'),page('Central de gráficos',home));
 return {batches:batches.length,featured:featured?.name??null};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(!process.argv[2])throw Error('Informe a pasta results.');console.log(await catalog(resolve(process.argv[2])));}catch(e){console.error(e);process.exitCode=1;}
}
