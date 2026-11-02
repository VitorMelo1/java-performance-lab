from pathlib import Path
import json,csv,zipfile,hashlib,io,collections,statistics,gzip,math,sys
sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path.cwd(); PKG=ROOT/'docs/entrega-artigo'; OUT=ROOT/'docs/revisao-independente-20261101'
def jload(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def zj(z,n): return json.loads(z.read(n).decode('utf-8-sig'))
def pct(x,p):
 s=sorted(x); i=(len(s)-1)*p; lo=int(i); hi=min(lo+1,len(s)-1); return s[lo]+(s[hi]-s[lo])*(i-lo)
report={}; runs={}; mismatches=[]
with zipfile.ZipFile(PKG/'Material-suplementar.zip') as z:
 names=z.namelist(); report['zip_entries']=len(names)
 for n in names:
  if n.startswith('dados/') and n.endswith('/result.json'):
   b,r=n.split('/')[1:3]; runs[b,r]=zj(z,n)
 report['packaged_run_results']=len(runs)
 report['missing_execution_files']=[n for n in ['scripts/Benchmark.ps1','scripts/Common.ps1','scripts/DiagnosticSupport.ps1','infra/init.sql','infra/orders.sql','infra/inventory.sql','infra/k6-clock/Dockerfile','infra/k6-clock/clock_regression_test.go'] if not any(x==n or x.endswith('/'+n) for x in names)]
 data=jload(PKG/'new-data.json'); old=jload(PKG/'article-data.json')
 for r in data['runs']:
  p=runs[r['batch'],r['run']]
  for k,pk in [('requests','requests'),('successful','successful_requests'),('p95','latency_p95_ms'),('p99','latency_p99_ms'),('drops','dropped_iterations'),('rps','successful_rps')]:
   if abs(r[k]-p[pk])>1e-8:mismatches.append((r['batch'],r['run'],k,r[k],p[pk]))
  w=zj(z,f"dados/{r['batch']}/{r['run']}/warmup/row.json")
  if r['warmup_errors']!=w['requests']-w['successful_requests']:mismatches.append(('warmup',r['run']))
 for b in old['batches']:
  for r in jload(PKG/(b+'.json')):
   p=runs[b,r['run']]
   for k in ['requests','successful_requests','latency_p95_ms','latency_p99_ms','dropped_iterations','successful_rps']:
    if abs(r[k]-p[k])>1e-8:mismatches.append((b,r['run'],k,r[k],p[k]))
 for r in old['diagnostic']['runs']:
  p=runs[r['batch'],r['run']]
  for k,pk in [('requests','requests'),('successful','successful_requests'),('p95_ms','latency_p95_ms'),('dropped','dropped_iterations')]:
   if abs(r[k]-p[pk])>1e-8:mismatches.append((r['batch'],r['run'],k,r[k],p[pk]))
 report['summary_mismatches']=mismatches
 report['batch_totals']={}
 for b in sorted({b for b,r in runs}):
  rr=[r for (bb,n),r in runs.items() if bb==b];report['batch_totals'][b]={'n':len(rr),'requests':sum(r['requests'] for r in rr),'errors':sum(r['requests']-r['successful_requests'] for r in rr),'drops':sum(r['dropped_iterations'] for r in rr)}
 # Match executable source snapshots against session manifests, rather than assuming current sources are historical.
 report['source_snapshot_matching']={}
 for b in ['20261015-011234-1ceec5','20261020-020913-fbd4ad','20261030-031922-3e0318','20261031-032121-95a2b8','20261101-014109-c2d17d']:
  mh={r['path'].replace('\\','/'):r['sha256'].lower() for r in csv.DictReader(io.StringIO(z.read('ambiente/'+b+'-source-hashes.csv').decode('utf-8-sig')))}
  matched={}; missing=[]
  for p,h in mh.items():
   matches=[s for s in ['codigo-referencia/','codigo-historico-29out/'] if s+p in names and hashlib.sha256(z.read(s+p)).hexdigest()==h]
   if matches: matched[p]=matches
   elif p.endswith(('.java','.properties','pom.xml','Dockerfile','compose.yaml')): missing.append(p)
  report['source_snapshot_matching'][b]={'matched_files':len(matched),'unmatched_important_files':missing}
 # Record snapshot Dockerfile and measured runtime evidence.
 report['packaged_current_mvc_dockerfile']=z.read('codigo-referencia/mvc-jdbc/Dockerfile').decode()
 report['runtime_evidence']={}
 for b,run in [('20261031-032121-95a2b8','008-mvc-feign-orders-r1000-rep1'),('20261101-014109-c2d17d','001-mvc-feign-orders-r1000-rep1')]:
  stem=f'dados/{b}/{run}/';candidate=stem+'prometheus-before.txt'
  if candidate not in names: candidate=next(n for n in names if n.startswith('dados/'+b) and n.endswith('/prometheus-before.txt'))
  report['runtime_evidence'][b]={'file':candidate,'jvm_info':[l for l in z.read(candidate).decode('utf-8-sig').splitlines() if l.startswith('jvm_info{')]}
 (OUT/'independent-checks.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
 print(json.dumps(report,indent=2,ensure_ascii=False))
