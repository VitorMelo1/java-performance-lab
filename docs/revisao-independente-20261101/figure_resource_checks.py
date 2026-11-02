"""Read-only, independent comparison of all figure points to archived run records and CPU counters."""
from pathlib import Path
import json,csv,zipfile,statistics,re,collections
p=Path('docs/entrega-artigo');out=Path(__file__).resolve().parent
def decode(b):return b.decode('utf-16' if b[:2] in (b'\xff\xfe',b'\xfe\xff') else 'utf-8-sig')
with zipfile.ZipFile(p/'Material-suplementar.zip') as z:
 names=set(z.namelist());runs={tuple(n.split('/')[1:3]):json.loads(decode(z.read(n))) for n in names if n.startswith('dados/') and n.endswith('/result.json')}
 points=list(csv.DictReader((p/'dados-das-figuras.csv').open(encoding='utf-8-sig')));bad=[];cgroups=[]
 for pt in points:
  b,r=pt['batch'],pt['run'];row=runs[b,r];m=pt['metric'];stem=f'dados/{b}/{r}/'
  if m=='throttled_periods_percent':
   def cg(n):return {k:int(v) for k,v in re.findall(r'^(nr_periods|nr_throttled) (\d+)\r?$',decode(z.read(stem+n)),re.M)}
   a,c=cg('cgroup-before.txt'),cg('cgroup-after.txt');val=100*(c['nr_throttled']-a['nr_throttled'])/(c['nr_periods']-a['nr_periods']);cgroups.append({'batch':b,'run':r,'percent':val,'periods':c['nr_periods']-a['nr_periods'],'throttled':c['nr_throttled']-a['nr_throttled']})
  elif m=='warmup_errors':
   w=json.loads(decode(z.read(stem+'warmup/row.json')));val=w['requests']-w['successful_requests']
  elif m=='delivery':val=100*row['successful_requests']/row['expected_requests']
  else:val=row[{'p95':'latency_p95_ms','p95_ms':'latency_p95_ms','rps':'successful_rps','drops':'dropped_iterations','dropped':'dropped_iterations'}.get(m,m)]
  if abs(float(pt['value'])-val)>1e-8:bad.append(pt)
 report={'figure_points_checked':len(points),'mismatches':bad,'independent_cgroup_delta_calculations':cgroups,'readme_replacement_characters':decode(z.read('README.md')).count('\ufffd')}
 b='20261031-032121-95a2b8';stock={};resources={}
 for (bb,r),row in sorted(runs.items()):
  if bb!=b:continue
  stem=f'dados/{b}/{r}/';cn=stem+'containers.json'
  if cn in names:
   for c in json.loads(decode(z.read(cn))):
    service=c.get('Config',{}).get('Labels',{}).get('com.docker.compose.service')
    if service=='stock-service':stock[r]={'id':c['Id'],'started':c['State']['StartedAt'],'image':c['Image']}
    resources[service]={'NanoCpus':c['HostConfig'].get('NanoCpus'),'CpuQuota':c['HostConfig'].get('CpuQuota'),'Memory':c['HostConfig'].get('Memory')}
 report['latest_recorded_container_resource_limits']=resources
 report['latest_stock_lifecycle']={'recorded_runs':len(stock),'unique_container_ids':len(set(s['id'] for s in stock.values())),'unique_start_times':sorted(set(s['started'] for s in stock.values()))}
 vals=collections.defaultdict(list)
 for (bb,r),row in sorted(runs.items()):
  if bb==b and row['offered_rps']==1000 and row['scenario'] in ['orders','db-read','db-write']:
   vals[(row['scenario'],row['variant'])].append(row['successful_rps']*row['latency_mean_ms']/1000)
 report['latest_1000rps_mean_http_inflight_proxy']={str(k):v for k,v in vals.items()}
 (out/'figure-and-resource-checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(report,ensure_ascii=True,indent=2))
