"""Confere contagens, tabelas e todos os pontos dos gráficos; Python 3 padrão."""
from pathlib import Path
import json,csv,statistics
O=Path(__file__).parent
def read(n):return json.loads((O/n).read_text(encoding='utf-8-sig'))
d=read('new-data.json');a=read('article-data.json');config=read('document-config.json');index={}
for b in a['batches']:
 for r in read(b+'.json'):index[b,r['run']]=dict(p95=r['latency_p95_ms'],rps=r['successful_rps'])
for r in a['diagnostic']['runs']:index[r['batch'],r['run']]=dict(r,p95=r['p95_ms'],rps=r['successful_rps'])
for r in d['runs']:index[r['batch'],r['run']]=dict(r,delivery=100*r['successful']/r['expected'])
assert len(index)==302
points=list(csv.DictReader((O/'dados-das-figuras.csv').open(encoding='utf-8-sig')))
for pt in points:
 r=index[pt['batch'],pt['run']];assert abs(float(pt['value'])-r[pt['metric']])<1e-8,pt
assert len(points)==355
main=[r for r in d['runs'] if not r['quick']]
assert len(main)==159 and sum(r['requests'] for r in main)==8332865
assert sum(r['errors'] for r in main)==0
latest=[r for r in main if r['batch']=='20261031-032121-95a2b8']
assert len(latest)==72 and sum(r['requests'] for r in latest)==3672060
assert sum(r['drops']+r['errors']+r['warmup_errors']+r['warmup_drops'] for r in latest)==0
for line in config['tables']['@sqltable']['rows']:
 sc={'Leitura':'db-read','Escrita':'db-write'}[line[0]];rate=int(line[1]);values=[]
 for v in ['mvc-resttemplate','webflux']:values.append(statistics.median(r['p95'] for r in latest if r['scenario']==sc and r['rate']==rate and r['variant']==v))
 assert line[2:]==[f'{v:.3f}'.replace('.',',') for v in [*values,values[1]-values[0]]]
checks=read('new-raw-validation.json');assert checks['complete'] and len(checks['checks'])==175
print('OK: 302 rodadas inventariadas, 355 pontos conferidos, seis linhas SQL recalculadas; 175 novas séries brutas verificadas.')
