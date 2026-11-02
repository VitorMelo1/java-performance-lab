"""Reproduz todas as figuras da revisão com Python 3 e matplotlib, sem Docker."""
from pathlib import Path
import json,csv,statistics
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
O=Path(__file__).parent
def read(n):return json.loads((O/n).read_text(encoding='utf-8-sig'))
D=read('new-data.json');old=read('article-data.json');diag=old['diagnostic']
rows=D['runs'];points=[];figures={};tables={}
colors={'mvc-resttemplate':'#28559a','webflux':'#13796e','mvc-feign':'#854296','inventory':'#666666'}
labels={'mvc-resttemplate':'MVC / RestTemplate','webflux':'WebFlux / WebClient','mvc-feign':'MVC / OpenFeign','inventory':'Estoque direto'}
variants=['mvc-resttemplate','webflux','mvc-feign'];rates=[200,500,1000]
plt.rcParams.update({'font.size':10,'figure.dpi':170,'savefig.dpi':200,'axes.spines.top':False,'axes.spines.right':False})
def select(batch,scenario,variant,rate):return sorted([r for r in rows if (r['batch'],r['scenario'],r['variant'],r['rate'])==(batch,scenario,variant,rate)],key=lambda r:r['repetition'])
def save(fig,name):
 fig.tight_layout();fig.savefig(O/(name+'.png'));fig.savefig(O/(name+'.svg'));plt.close(fig)
def plot(ax,rs,key,x,figure,condition,color,marker='o'):
 vals=[r[key] for r in rs];xs=[x+(i-(len(rs)-1)/2)*.025 for i in range(len(rs))]
 ax.scatter(xs,vals,color=color,marker=marker,s=27,zorder=3);ax.plot([x-.06,x+.06],[statistics.median(vals)]*2,color=color,lw=2)
 for r,y in zip(rs,vals):points.append(dict(figure=figure,condition=condition,batch=r['batch'],run=r['run'],variant=r['variant'],metric=key,value=y))
def load_curve(ax,batch,scenario,variant,key,name,label,vi):
 medians=[]
 for rate in rates:
  rs=select(batch,scenario,variant,rate)
  if key=='delivery':rs=[dict(r,delivery=100*r['successful']/r['expected']) for r in rs]
  vals=[r[key] for r in rs];medians.append(statistics.median(vals))
  # Small horizontal offsets separate repetitions; median lines use true rate values.
  xs=[rate+(vi-1)*13+(j-1)*4 for j in range(len(rs))]
  ax.scatter(xs,vals,color=colors[variant],s=20,alpha=.5,zorder=3)
  for r,y in zip(rs,vals):points.append(dict(figure=name,condition=f'{scenario}/{rate}' if scenario!='orders' else str(rate),batch=r['batch'],run=r['run'],variant=variant,metric=key,value=y))
 ax.plot(rates,medians,color=colors[variant],marker=['o','s','^'][vi],markersize=5,linestyle=['-','--',':'][vi],linewidth=2,label=label,zorder=4)
def axes_load(ax):
 ax.set_xticks(rates);ax.set_xlim(120,1080);ax.tick_params(labelsize=10)
 ax.set_xlabel('Carga programada (requisições/s)',fontsize=11);ax.grid(axis='y',alpha=.2)
def sql(batch,name):
 fig,axs=plt.subplots(1,2,figsize=(9,3.6))
 for ax,sc,title in zip(axs,['db-read','db-write'],['Leitura SQL','Escrita SQL']):
  for vi,v in enumerate(variants[:2]):load_curve(ax,batch,sc,v,'p95',name,'MVC / JDBC' if vi==0 else 'WebFlux / R2DBC',vi)
  axes_load(ax);ax.set_ylabel('p95 por rodada (ms)',fontsize=11);ax.set_ylim(bottom=0);ax.set_title(title,fontsize=12)
 axs[0].legend(fontsize=10,loc='lower left');save(fig,name)
def orders(batch,name):
 fig,axs=plt.subplots(1,2,figsize=(9,3.6))
 for vi,v in enumerate(variants):
  load_curve(axs[0],batch,'orders',v,'p95',name,labels[v],vi)
  load_curve(axs[1],batch,'orders',v,'delivery',name,labels[v],vi)
 for ax in axs:axes_load(ax)
 axs[0].set_ylabel('p95 por rodada (ms)',fontsize=11);axs[0].set_ylim(bottom=0);axs[0].legend(fontsize=9,loc='upper left')
 if name=='suplemento-pedidos-30out':
  from matplotlib.ticker import ScalarFormatter
  axs[0].set_yscale('log');axs[0].set_ylim(2,1000);axs[0].set_yticks([2,5,10,20,50,100,200,500,1000]);axs[0].yaxis.set_major_formatter(ScalarFormatter());axs[0].set_ylabel('p95 (ms · escala logarítmica)',fontsize=11)
  for v,dy in zip(variants,[-14,10,12]):
   value=statistics.median(r['p95'] for r in select(batch,'orders',v,1000))
   axs[0].annotate(f'{value:.1f}'.replace('.',','),(1000,value),xytext=(-8,dy),textcoords='offset points',ha='right',color=colors[v],fontsize=10,fontweight='bold')
 axs[1].set_ylabel('Respostas corretas / programadas (%)',fontsize=10);axs[1].set_ylim(0,105);axs[1].axhline(100,ls='--',color='gray',lw=.8)
 if all(r['drops']==0 and r['errors']==0 for r in rows if r['batch']==batch and r['scenario']=='orders'):
  axs[1].text(.5,.67,'Todas as variantes: ≈100%\nSem erros ou descartes',transform=axs[1].transAxes,ha='center',fontsize=10,color='#34434d')
 save(fig,name)
latest='20261031-032121-95a2b8';previous='20261030-031922-3e0318'
sql(latest,'figura-1-sql');orders(latest,'figura-2-pedidos')
sql(previous,'suplemento-sql-30out');orders(previous,'suplemento-pedidos-30out')
# Historical sessions and revised implementations are labelled separately, never pooled.
history=[]
for batch,lab in [('20261015-011234-1ceec5','15/10'),('20261020-020913-fbd4ad','20/10')]:
 for r in read(batch+'.json'):
  if r['scenario']=='orders' and r['offered_rps']==1000:history.append(dict(batch=batch,run=r['run'],variant=r['variant'],label=lab,p95=r['latency_p95_ms'],rps=r['successful_rps']))
for r in diag['runs']:
 if r['stage']=='baseline':history.append(dict(r,label='29/10',p95=r['p95_ms'],rps=r['successful_rps']))
for batch,lab in [(previous,'30/10'),(latest,'31/10')]:
 for r in rows:
  if r['batch']==batch and r['scenario']=='orders' and r['rate']==1000:history.append(dict(r,label=lab))
def pretty(value,decimals=1):
 return f'{value:.{decimals}f}'.replace('.',',')
def remember(rs,key,name,condition):
 for r in rs:points.append(dict(figure=name,condition=condition,batch=r['batch'],run=r['run'],variant=r['variant'],metric=key,value=r[key]))
# Explicit numeric matrices replace the crowded date/marker legend.
dates=['15/10','20/10','29/10','30/10','31/10']
fig,axs=plt.subplots(2,1,figsize=(8,5.6))
for ax,key,title in zip(axs,['p95','rps'],['Latência p95 (ms) — menor é melhor','Vazão correta (req/s) — maior é melhor']):
 med=[];ranges=[]
 for v in variants:
  med.append([]);ranges.append([])
  for lab in dates:
   rs=[r for r in history if r['variant']==v and r['label']==lab];vals=[r[key] for r in rs]
   med[-1].append(statistics.median(vals));ranges[-1].append((min(vals),max(vals)))
   remember(rs,key,'figura-3-sessoes',lab)
 # Neutral shading: cells are a readable numerical matrix, not a color scale.
 from matplotlib.patches import Rectangle
 for yi in range(3):
  for xi in range(5):
   ax.add_patch(Rectangle((xi-.5,yi-.5),1,1,facecolor='#eef3f6' if yi%2==0 else '#ffffff',edgecolor='#cbd5dc',lw=.8))
   ax.text(xi,yi-.13,pretty(med[yi][xi]),ha='center',va='center',fontsize=13,fontweight='bold',color=colors[variants[yi]])
   lo,hi=ranges[yi][xi];ax.text(xi,yi+.20,f'{pretty(lo)}–{pretty(hi)}',ha='center',va='center',fontsize=9.5,color='#3b4751')
 ax.set_xlim(-.5,4.5);ax.set_ylim(2.5,-.5);ax.set_xticks(range(5),dates,fontsize=11);ax.xaxis.tick_top()
 ax.set_yticks(range(3),['MVC /\nRestTemplate','WebFlux /\nWebClient','MVC /\nOpenFeign'],fontsize=10)
 ax.tick_params(length=0,pad=7);ax.set_title(title,fontsize=13,pad=28)
 for spine in ax.spines.values():spine.set_visible(False)
fig.tight_layout(h_pad=2.3);fig.savefig(O/'figura-3-sessoes.png');fig.savefig(O/'figura-3-sessoes.svg');plt.close(fig)

def bars(ax,groups,key,name,color,xlabel,decimals=1):
 med=[];low=[];high=[]
 for condition,rs in groups:
  vals=[r[key] for r in rs];m=statistics.median(vals);med.append(m);low.append(m-min(vals));high.append(max(vals)-m)
  remember(rs,key,name,condition)
 ys=list(range(len(groups)));ax.barh(ys,med,color=color,alpha=.8,height=.52,zorder=2)
 ax.errorbar(med,ys,xerr=[low,high],fmt='none',ecolor='#38434b',capsize=4,lw=1.2,zorder=3)
 maximum=max(m+h for m,h in zip(med,high));limit=max(maximum,1)*1.42
 ax.set_xlim(0,limit);ax.set_ylim(len(groups)-.5,-.5);ax.grid(axis='x',alpha=.18,zorder=0);ax.set_xlabel(xlabel,fontsize=10)
 for y,m,h in zip(ys,med,high):ax.text(m+h+limit*.025,y,pretty(m,decimals),va='center',fontsize=11,fontweight='bold',color='#182b37')
 ax.tick_params(axis='x',labelsize=9);ax.tick_params(axis='y',length=0)

stages=['baseline','webflux-vus1000','webflux-cpu4','baseline-final']
groups=[(stage,[r for r in diag['runs'] if r['stage']==stage and r['variant']=='webflux']) for stage in stages]
fig,axs=plt.subplots(2,2,figsize=(8.5,5.8))
specs=[('p95_ms','Latência p95','ms · menor é melhor',1),('successful_rps','Vazão correta','req/s · maior é melhor',1),('throttled_periods_percent','Restrição de CPU','% dos períodos · menor é melhor',1),('dropped','Carga não iniciada','iterações por rodada · menor é melhor',0)]
for ax,(key,title,xlabel,decimals) in zip(axs.flat,specs):
 bars(ax,groups,key,'figura-4-diagnostico','#13796e',xlabel,decimals)
 ax.set_yticks(range(4),['A · Referência','B · Mais VUs','C · Mais CPU','D · Retorno'],fontsize=10)
 ax.set_title(title,fontsize=12,fontweight='bold',loc='left')
fig.tight_layout(w_pad=2.0,h_pad=2.0);fig.savefig(O/'figura-4-diagnostico.png');fig.savefig(O/'figura-4-diagnostico.svg');plt.close(fig)

feignbatches=[previous,'20261030-140228-6741d1','20261031-030111-8cbb28',latest,'20261101-014109-c2d17d']
groups=[(b,select(b,'orders','mvc-feign',1000)) for b in feignbatches]
fig,axs=plt.subplots(1,3,figsize=(8.5,4.0),sharey=True)
for ax,key,title,xlabel,decimals in zip(axs,['warmup_errors','p95','drops'],['Erros no\naquecimento','Latência p95\nna medição','Carga não iniciada\nna medição'],['respostas inválidas','ms','iterações'],[0,1,0]):
 bars(ax,groups,key,'figura-5-validacao','#854296',xlabel,decimals);ax.set_title(title,fontsize=11,fontweight='bold')
axs[0].set_yticks(range(5),['30/10 · antes','30/10 · após','31/10 · Balanced','31/10 · High perf.','01/11 · JVM fixada'],fontsize=10)
fig.tight_layout(w_pad=1.4);fig.savefig(O/'figura-5-validacao.png');fig.savefig(O/'figura-5-validacao.svg');plt.close(fig)
def num(x,n=3):return f'{x:.{n}f}'.replace('.',',')
figures={
'@figure1':dict(n=1,file='figura-1-sql.png',caption='Operações SQL na coleta revisada de 31 de outubro',note='Linhas e marcadores: medianas; pontos menores: três repetições, deslocadas horizontalmente para leitura. Cargas em escala numérica. Segmentos guiam a leitura; cargas intermediárias não foram medidas.'),
'@figure2':dict(n=2,file='figura-2-pedidos.png',caption='Pedidos na coleta revisada de 31 de outubro',note='Linhas e marcadores: medianas; pontos menores: três repetições. Segmentos guiam a leitura, sem medições intermediárias. Entrega próxima a 100% faz as linhas se sobreporem no painel direito; não significa capacidade máxima.'),
'@figure3':dict(n=3,file='figura-3-sessoes.png',caption='Pedidos a 1.000 req/s entre sessões e versões',note='Cada célula mostra a mediana em negrito e o mínimo–máximo abaixo (n = 3). Colunas: sessões distintas; não são uma curva temporal controlada. Feign, JVM e plano de energia mudaram entre coletas. WebFlux teve descartes em 20, 29 e 30/10.'),
'@figure4':dict(n=4,file='figura-4-diagnostico.png',caption='Diagnóstico histórico do WebFlux em 29 de outubro',note='Barras e números: medianas; hastes: mínimo–máximo, não intervalo de confiança. A: 2 CPUs/500 VUs; B: 2 CPUs/1.000 VUs; C: 4 CPUs/500 VUs (n = 3 em A–C). D: retorno a 2 CPUs/500 VUs (n = 1). ActiveProcessorCount=2 permanece fixo. Restrição é percentual de períodos, não tempo perdido.'),
'@figure5':dict(n=5,file='figura-5-validacao.png',caption='Validação do OpenFeign a 1.000 pedidos por segundo',note='Barras e números: medianas de três repetições; hastes: mínimo–máximo. Antes/após referem-se à inicialização dos conversores. Zero erros não significa ausência de descartes. Planos de energia e JVM diferem entre lotes; nenhuma ligação entre condições é presumida.')}
tables['@environment']=dict(caption='Tabela 1 – Recursos por componente',headers=['Componente','Cota e memória','Configuração'],widths=[3.7,4.3,8],rows=[['API avaliada','2 CPUs; 1 GiB','Heap 512 MiB; G1; ActiveProcessorCount=2; pool SQL 20'],['PostgreSQL da API','2 CPUs; 768 MiB','PostgreSQL 17.4; 10.000 produtos'],['Serviço de estoque','1 CPU; 640 MiB','Heap 256 MiB; G1; ActiveProcessorCount=1'],['PostgreSQL do estoque','1 CPU; 512 MiB','Banco separado'],['Gerador k6','2 CPUs; 1 GiB','500 VUs; 60 s de aquecimento + 90 s de medição']],note='No diagnóstico histórico, somente as condições identificadas alteram CPU da API ou VUs. O pool HTTP de 100 conexões aplica-se a RestTemplate e WebClient e ao Feign revisado; não ao Feign histórico.')
tables['@sessiontable']=dict(caption='Tabela 2 – Coletas e versões preservadas',headers=['Coleta','n¹','JVM Temurin','Feign e plano de energia'],widths=[2.5,1.2,3.1,9.2],rows=[['15 e 20/10','102','21.0.12.1+1','Transporte padrão; High performance'],['29/10','21','21.0.12.1+1','Transporte padrão; Razer Cortex; intervenções'],['30/10 completa','72','21.0.13+9','HC5 explícito; Razer Cortex; conversores sob demanda'],['30/10 validação','3','21.0.13+9','HC5; conversores antecipados; Razer Cortex'],['31/10 validação','3','21.0.13+9','HC5; conversores antecipados; Balanced'],['31/10 completa','72','21.0.13+9','HC5; conversores antecipados; High performance'],['01/11 validação','9','21.0.12.1+1','HC5; conversores antecipados; High performance']],note='¹ Rodadas principais. Outros 20 testes curtos são preservados, mas excluídos da análise de desempenho. Em 01/11 as imagens base foram fixadas por digest. As sessões não são replicações de uma única configuração.')
sqlrows=[]
for sc,l in [('db-read','Leitura'),('db-write','Escrita')]:
 for rate in rates:
  a,b=[statistics.median(r['p95'] for r in select(latest,sc,v,rate)) for v in variants[:2]]
  sqlrows.append([l,str(rate),num(a),num(b),num(b-a)])
tables['@sqltable']=dict(caption='Tabela 4 – Medianas dos p95 SQL em 31 de outubro',headers=['Cenário','req/s','MVC (ms)','WebFlux (ms)','Diferença (ms)'],widths=[3,2,3.5,3.5,4],rows=sqlrows,note='Três repetições por condição; diferença = WebFlux − MVC. Medianas de p95 não equivalem ao p95 de todas as requisições agrupadas.')
batchrows=[]
for b in D['batches']:
 if not b['quick']:batchrows.append([b['batch'][6:8]+'/'+b['batch'][4:6]+' '+('completa' if b['n']==72 else 'validação'),str(b['n']),f"{b['requests']:,}".replace(',','.'),str(b['errors']),str(b['drops']),str(b['warmup_errors'])])
tables['@newquality']=dict(caption='Tabela 3 – Integridade e entrega nas novas coletas',headers=['Coleta','n','Requisições','Erros¹','Descartes¹','Erros²'],widths=[3.7,1,3.6,2.1,2.6,3],rows=batchrows,note='¹ Medição. ² Aquecimento. As duas fases são separadas. Todas as novas rodadas tiveram zero amostras excluídas; testes curtos ficam fora desta tabela.')
(O/'document-config.json').write_text(json.dumps({'figures':figures,'tables':tables},ensure_ascii=False,indent=2),encoding='utf-8')
with (O/'dados-das-figuras.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.DictWriter(f,fieldnames=points[0]);w.writeheader();w.writerows(points)
print('Figures regenerated:',len(figures)+2,'; points:',len(points));print('SQL',sqlrows)
