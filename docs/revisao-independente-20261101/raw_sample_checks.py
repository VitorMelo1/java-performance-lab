"""Independent, read-only audit of eight purposefully selected archived raw measurement streams.
Uses only Python standard library and does not import project validators.
Run from the project root. Outputs only to this review directory.
"""
from pathlib import Path
import csv,json,zipfile,gzip,collections,math,hashlib,sys
sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path.cwd(); PKG=ROOT/'docs/entrega-artigo'; OUT=Path(__file__).resolve().parent
selected=[
('20261031-032121-95a2b8','001-webflux-db-read-r1000-rep1'),
('20261031-032121-95a2b8','005-mvc-resttemplate-db-read-r1000-rep1'),
('20261031-032121-95a2b8','006-mvc-resttemplate-orders-r1000-rep1'),
('20261031-032121-95a2b8','008-mvc-feign-orders-r1000-rep1'),
('20261031-032121-95a2b8','016-webflux-orders-r1000-rep1'),
('20261020-020913-fbd4ad',None),
('20261029-042801-b8e74e','001-webflux-orders-r1000-rep1'),
('20261101-014109-c2d17d','001-mvc-feign-orders-r1000-rep1')]
def pct(x,p):
 i=(len(x)-1)*p; lo=int(i); hi=min(lo+1,len(x)-1); return x[lo]+(x[hi]-x[lo])*(i-lo)
results=[]
with zipfile.ZipFile(PKG/'Dados-brutos.zip') as raw,zipfile.ZipFile(PKG/'Material-suplementar.zip') as summaries:
 for b,r in selected:
  if r is None:
   r=next(n.split('/')[2] for n in raw.namelist() if n.startswith('dados/'+b+'/') and 'webflux-orders-r1000-rep1/' in n)
  stem=f'dados/{b}/{r}/'; n=stem+'samples.json.gz'
  # Hash comparison checks that the audited published bytes match the corresponding on-disk run.
  published_hash=hashlib.sha256(raw.read(n)).hexdigest(); local_hash=hashlib.sha256((ROOT/'results'/b/r/'samples.json.gz').read_bytes()).hexdigest()
  row=json.loads(summaries.read(stem+'result.json').decode('utf-8-sig'))
  vals=collections.defaultdict(list); cnt=collections.Counter();status=collections.Counter();lines=0
  keep=['request_latency_ms','http_req_duration','client_latency_ms','request_blocked_ms']
  counters=['http_reqs','successful_requests','dropped_iterations','invalid_responses','http_req_failed']
  with raw.open(n) as zf,gzip.open(zf,'rt',encoding='utf-8') as f:
   for line in f:
    lines+=1
    p=json.loads(line)
    if p.get('type')!='Point':continue
    m=p['metric'];v=p['data']['value']
    if m in keep: vals[m].append(v)
    if m in counters:cnt[m]+=v
    if m=='http_reqs':status[str(p['data'].get('tags',{}).get('status'))]+=v
  for v in vals.values():v.sort()
  result={'batch':b,'run':r,'json_lines_read':lines,'compressed_sha256':published_hash,'archive_equals_local':published_hash==local_hash,
   'counts':dict(cnt),'status':dict(status),'duration_count':len(vals['http_req_duration']),'custom_latency_count':len(vals['request_latency_ms']),
   'negative_or_nonfinite':sum(not math.isfinite(v) or v<0 for v in vals['request_latency_ms']),
   'p50_ms':pct(vals['request_latency_ms'],.5),'p95_ms':pct(vals['request_latency_ms'],.95),'p99_ms':pct(vals['request_latency_ms'],.99),
   'native_custom_values_identical':vals['http_req_duration']==vals['request_latency_ms'],
   'client_p95_ms':pct(vals['client_latency_ms'],.95),'blocked_p95_ms':pct(vals['request_blocked_ms'],.95)}
  result['summary_matches']=all(abs(result[k]-row[rk])<1e-8 for k,rk in [('p50_ms','latency_p50_ms'),('p95_ms','latency_p95_ms'),('p99_ms','latency_p99_ms')]) and cnt['http_reqs']==row['requests'] and cnt['successful_requests']==row['successful_requests'] and cnt['dropped_iterations']==row['dropped_iterations']
  results.append(result)
  (OUT/'raw-sample-checks.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
  print(json.dumps(result),flush=True)
print('SCOPE: eight selected archived measurement streams, not a full 302-stream raw audit.',flush=True)
