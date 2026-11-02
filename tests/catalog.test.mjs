import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {catalog} from '../benchmarks/catalog.mjs';

test('central destaca coleta completa, separa ensaio curto e preserva repeticoes e arquivos',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lab-catalog-'));
 try{
  for(const [name,quick,state] of [['20261015-010000-aaaaaa',false,'complete'],['20261020-010000-bbbbbb',true,'complete'],['20261020-020000-cccccc',false,'failed']]){
   const b=join(root,name);await mkdir(join(b,'report'),{recursive:true});
   await writeFile(join(b,'metadata.json'),JSON.stringify({quick,protocolVersion:4,timingRevision:'monotonic-anchor-v1'}));
   await writeFile(join(b,'status.json'),JSON.stringify({state,planned:3,completed:3}));
   await writeFile(join(b,'report','index.html'),'original report');
   await writeFile(join(b,'report','latencia-p95-orders.svg'),'<svg/>');
   for(const [rep,value] of [[1,4],[2,3],[3,8]]){
    const run=`00${rep}-webflux-orders-r500-rep${rep}`;await mkdir(join(b,run));
    await writeFile(join(b,run,'result.json'),JSON.stringify({scenario:'orders',variant:'webflux',offered_rps:500,repetition:rep,latency_p95_ms:value,successful_rps:500,error_count:0,dropped_iterations:0,analysis_status:'ok',stability_status:'sem_alerta',load_delivered:true,run}));
   }
  }
  const result=await catalog(root);
  assert.equal(result.featured,'20261015-010000-aaaaaa');
  const home=await readFile(join(root,'index.html'),'utf8');
  assert.match(home,/Ensaios curtos e coletas incompletas/);
  const page=await readFile(join(root,result.featured,'report','navegar.html'),'utf8');
  assert.match(page,/Repetição 3/);assert.match(page,/8,000/);
  assert.match(page,/latencia-p95-orders.svg/);assert.doesNotMatch(page,/src="vazao-orders.svg"/);
  assert.match(page,/warm|Aquecimento/i);
  assert.equal(await readFile(join(root,result.featured,'report','index.html'),'utf8'),'original report');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('central sem lotes explica como gerar resultados',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lab-catalog-empty-'));
 try{const result=await catalog(root);assert.equal(result.featured,null);assert.match(await readFile(join(root,'index.html'),'utf8'),/Nenhuma coleta/);}
 finally{await rm(root,{recursive:true,force:true});}
});

test('diagnostico mais recente nao substitui coleta do artigo em destaque',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lab-catalog-diagnostic-'));
 try{
  for(const [name,diagnostic] of [['20261015-010000-aaaaaa',false],['20261027-010000-bbbbbb',true]]){
   const b=join(root,name);await mkdir(join(b,'report'),{recursive:true});
   await writeFile(join(b,'metadata.json'),JSON.stringify({diagnostic,protocolVersion:4,timingRevision:'monotonic-anchor-v1'}));
   await writeFile(join(b,'status.json'),JSON.stringify({state:'complete',planned:3,completed:3}));
   await writeFile(join(b,'report','index.html'),'original');
  }
  const result=await catalog(root);
  assert.equal(result.featured,'20261015-010000-aaaaaa');
  assert.match(await readFile(join(root,'20261027-010000-bbbbbb','report','navegar.html'),'utf8'),/Diagnóstico com intervenção/);
 }finally{await rm(root,{recursive:true,force:true});}
});
