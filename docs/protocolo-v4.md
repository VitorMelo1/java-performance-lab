# Protocolo 4 — correções de instrumentação e análise

Estado: as correções de código estão aplicadas; **nenhuma coleta foi feita com elas**. Os
lotes de 4 e 5 out. 2026 pertencem ao protocolo 3 e permanecem intactos em `results/`.
`protocol_version` passa a 4 e `report.mjs` recusa agregar versões diferentes, de modo que
os dois conjuntos não se misturam por acidente. O DOCX continua descrevendo o protocolo
anterior.

Este documento registra o que mudou, por quê, e o que ainda depende de nova coleta ou de
configuração da máquina. O [protocolo 3](protocolo-v3.md) continua válido como descrição
dos lotes de outubro.

## Por que recoletar

Os dois lotes completos de 72 rodadas foram gerados pelo k6 **sem** a correção de relógio:
`results.csv` dos lotes `20261004-040105-a4ab77` e `20261005-010519-c1d0d5` não tem o campo
`timing_revision`. Somente o lote curto `20261005-134344-e78717`, de 8 rodadas, usou
`k6 v1.0.0-labclock1`. Como `Benchmark.ps1` agora aborta se o gerador não for essa versão,
os lotes antigos também não são reproduzíveis com os scripts atuais.

As amostras negativas confirmam o diagnóstico de relógio civil: valores de −0,70 a
−2,37 ms, e duas delas, na rodada `022-mvc-resttemplate-db-read-r1000-rep1`, separadas por
exatamente 30 s (`05:07:21,8958` e `05:07:51,8968`). Isso é compatível com correção
periódica do relógio do convidado. Além do patch do gerador, **desative a sincronização de
tempo do convidado durante a coleta** (ver abaixo).

## O que mudou no código

### Geração de carga — `benchmarks/load.js`

| Mudança | Motivo |
|---|---|
| `protocol_version` 3 → 4 | O desenho do experimento mudou; os lotes não devem ser agrupados. |
| Aquecimento sobe ao longo de 75% da janela e termina com platô na taxa alvo (`WARMUP=1` usa `ramping-arrival-rate`) | O aquecimento na taxa alvo não entregava a carga: em `orders` a 1000 req/s foram ~100 mil iterações descartadas por braço no aquecimento, de 180 mil previstas. A JVM entrava na medição aquecida por um número **diferente** de requisições em cada braço. Ver a seção da rodada de diagnóstico abaixo, que mostrou por que uma subida curta não resolvia. |
| `plateau_delivered_fraction` e `above_knee` | Separam "a aplicação começou fria" de "a aplicação não sustenta esta taxa". Sem isso, descarte no aquecimento era ambíguo. |
| `expected_requests` no `row.json` | Com degrau, a carga oferecida não é taxa × duração; a análise precisa do valor real. |
| `db-write` grava valor variável (`100 + iteração % 401`) | O UPDATE gravava o mesmo 100 do povoamento: elegível a HOT, sem tocar índice, escrita irrealisticamente barata e idêntica em toda iteração. |
| Novas métricas `request_blocked_ms` e `client_latency_ms` | `timings.duration` exclui o bloqueio do gerador. A latência que o cliente observa é duração + bloqueio; sob saturação o enfileiramento ficava invisível na métrica principal. |
| `delivered_fraction` no `row.json` | Torna explícito, por rodada, quanto da carga oferecida foi entregue. |

### Aplicações e ambiente

| Mudança | Motivo |
|---|---|
| `-XX:+UseG1GC` explícito nos três serviços Java | Nenhum coletor estava especificado. Com 768 MiB de container (abaixo do limiar de 1792 MiB), a ergonomia da JVM classificava a máquina como *client class* e selecionava SerialGC. |
| Heap 256 → 512 MiB; container 768 MiB → 1 GiB | O WebFlux acumulou 170 pausas, 5,077 s totais e pausa máxima de 206 ms em `orders` a 1000 req/s, contra 88 pausas e 1,004 s do MVC. Heap igual não é tratamento justo: Reactor e Netty alocam mais por requisição. O MVC chegava a 225 MiB usados de 256 MiB. |
| `-Xlog:gc+init=info:stderr` | Registra uma vez, em `services.log`, qual coletor ficou ativo. Antes não havia como saber. |
| `spring.r2dbc.pool.acquire-retry=0` | O padrão do r2dbc-pool é 1: uma tentativa extra de aquisição que o HikariCP não faz. |
| `spring.r2dbc.pool.max-life-time`/`max-idle-time`/`min-idle` e `hikaricp.max-lifetime` explícitos | Alinha as políticas de ciclo de vida dos dois pools. |
| Mapeamento de linha escrito à mão no MVC e no stock-service | O MVC usava `query(Product.class)` (`SimplePropertyRowMapper`, reflexão por linha); o WebFlux sempre mapeou explicitamente. Em consulta de sub-milissegundo esse custo assimétrico entra na medição. |

Assimetria que **não** foi corrigida, por não ser configurável: o r2dbc-pool não expõe
limite para a fila de aquisições pendentes, enquanto no MVC a espera é limitada pelos 200
workers do Tomcat. Sob saturação o braço reativo acumula fila maior. Está comentada em
`webflux-r2dbc/src/main/resources/application.properties` e deve ser declarada nos
resultados.

### Segunda fonte de medição: latência do lado do servidor

O `spring-boot-starter-actuator` já estava nos três poms, mas `http.server.requests` nunca
era coletado: o artigo tinha uma única fonte de latência, o gerador. Foi adicionado
`micrometer-registry-prometheus` aos três módulos (simetricamente) e o endpoint
`prometheus` exposto, com histograma habilitado para `http.server.requests` e limites de
500 µs a 5 s.

`Benchmark.ps1` faz dois scrapes, um imediatamente antes e outro imediatamente depois da
medição, gravados em `prometheus-before.txt` e `prometheus-after.txt`. Os baldes do
histograma são contadores **acumulados**: a subtração dos dois scrapes dá a distribuição
exata da janela medida, calculada **dentro da aplicação** — sem o relógio do k6, sem o
tempo de bloqueio do gerador e sem o piso dependente da taxa.

É isso que torna verificável a afirmação de que o piso de cerca de 1 ms é do laboratório:
se `server_p95_median` ficar estável enquanto `p95_median` varia com a taxa, a origem é o
gerador. Sem essa segunda fonte a afirmação não tem contraprova.

Onde o percentil cai no balde `+Inf` ele é reportado como indisponível, não estimado, e
`server_histogram_saturated_repetitions` registra em quantas repetições isso aconteceu.

Um detalhe que custou um bug: as rotas são templates e o rótulo `uri="/api/products/{id}"`
contém chaves, o que quebrava a delimitação dos rótulos na primeira versão do analisador.
Há teste cobrindo isso, e também a exclusão das requisições ao próprio `/actuator` — o
coletor bate nele a cada 3 s e entraria na distribuição que se quer medir.

### CPU por requisição e contadores de pool

| Mudança | Motivo |
|---|---|
| `process.cpu.time` coletado e diferenciado pela janela medida | A CPU por requisição vinha da mediana de `docker stats` amostrada a cada 3–6 s. Esse contador acumulado dá o valor exato: `app_cpu_ms_per_request`. A medida por container continua disponível como `app_cpu_percent_per_1000_rps`. |
| `hikaricp.connections.timeout`, `.acquire`, `.usage`, `.creation` | `hikaricp.connections.pending` é gauge e apareceu 0,0 em **todas** as amostras do lote de outubro: a história do esgotamento de pool do Feign se apoiava apenas no log da aplicação. Contadores cumulativos não escapam entre amostras. |
| `r2dbc.pool.allocated`, `.max.allocated`, `.max.pending` | Equivalentes disponíveis no braço reativo. |

Assimetria de instrumentação a declarar: o r2dbc-pool **não** expõe contador de timeout de
aquisição equivalente ao do Hikari. Os dois braços não têm a mesma visibilidade de pool.

Também foi corrigido um defeito do próprio protocolo 4: `jvm.gc.pause` COUNT e TOTAL_TIME
são acumulados desde o início da JVM, e a aplicação reinicia a cada rodada com o
aquecimento antes da medição. Ler o último valor atribuía à medição também o GC do
aquecimento. Agora o valor é a diferença contra o fim do aquecimento, e `app_gc_window`
declara se é `medicao` ou `cumulativo_inclui_aquecimento`. `MAX` continua cumulativo por
ser máximo em janela deslizante do Micrometer, não contador.

### Harness — `scripts/Benchmark.ps1` e `scripts/Common.ps1`

| Mudança | Motivo |
|---|---|
| Coletor de recursos roda no aquecimento **e** na medição | Antes rodava só na medição: `docker stats --no-stream` e oito chamadas ao Actuator a cada ~3 s eram um custo que apenas a janela medida pagava. |
| Lista de métricas por braço (`Get-JvmMetricNames`) | Pedia `hikaricp.*` no WebFlux e `r2dbc.*` no MVC: metade das chamadas devolvia erro em toda amostra, dentro da janela medida. |
| `samples.json.gz` escrito em `/tmp` do container e copiado depois | O k6 gravava mais de um milhão de linhas JSON comprimidas direto no bind mount do Windows durante a medição — custo de I/O ausente no aquecimento e crescente com a taxa. |
| `Reset-LabDatabase` também **depois** do aquecimento em `db-write` | Só `orders` era restaurado ali. A 1000 req/s o aquecimento fazia ~60 mil UPDATEs em 10 mil linhas e a medição começava com a tabela carregada de tuplas mortas, com autovacuum podendo disparar dentro da janela. |
| `shuffle_index` como desempate em `Sort-Object repetition` | `Sort-Object` não é estável no Windows PowerShell 5.1 (`-Stable` só existe no 6.2+), então a ordem sorteada era descartada e a semente não reproduzia a sequência. |
| Percentis do `result.json` vindos de `quality.json` | Ver a política de exclusão abaixo. O resumo do k6 fica preservado em `k6_latency_p50/95/99_ms`. |
| `powerPlan` no `metadata.json` | Ver configuração da máquina abaixo. |
| Cenário `knee` e `scripts/Knee.ps1` | 200 e 500 req/s estavam ociosos, 1000 já havia colapsado, e não havia nenhum ponto entre 500 e 1000. |

### Política de exclusão — `benchmarks/quality.mjs`

O protocolo 3 abortava a rodada inteira na primeira duração impossível, de modo que uma
amostra em 90 mil removia uma repetição completa. Custo real no lote de 5 de outubro: duas
das três rodadas `mvc-resttemplate/db-read` a 1000 req/s foram excluídas (`022` e `070`),
deixando **n=1 ao lado de n=3** — e as rodadas removidas eram comuns (p95 de 1,242 e
1,282 ms contra 1,256 ms da que ficou). A exclusão reduziu n sem remover discrepantes, e
não era aleatória em relação ao braço.

No protocolo 4, declarado antes da coleta:

- as amostras impossíveis são retiradas **ponto a ponto** e a rodada é preservada;
- o orçamento é de no máximo 10 amostras e 0,1% das requisições por rodada;
- cada valor retirado precisa aparecer também em `http_req_duration`, a métrica nativa do
  k6; sem essa confirmação a rodada é rejeitada;
- acima do orçamento a rodada continua rejeitada: aí a medição está quebrada;
- os percentis passam a ser recalculados das amostras brutas analisadas, pela mesma
  fórmula em **toda** rodada, tenha havido exclusão ou não (`latency_basis`), com o resumo
  do k6 guardado ao lado para conferência;
- `quality.json` registra a contagem, a fração, os valores e a confirmação nativa.

`benchmarks/sensitivity.mjs` continua aceitando **apenas** protocolo 3 e permanece como a
ferramenta de releitura dos lotes de outubro. No protocolo 4 o papel se inverte: a
filtragem por ponto é a análise principal.

### Relatório — `benchmarks/report.mjs`

| Mudança | Motivo |
|---|---|
| Uma figura por cenário, com escala calculada dentro do cenário | Havia um único eixo linear compartilhado: com `orders` a ~1350 ms na mesma figura, cada barra de SQL (1–5 ms) virava uma lasca de um pixel. |
| `comparable_latency`, `delivered_fraction_median`, `load_delivered_repetitions` | Onde a carga oferecida não foi entregue, o p95 não é comparável entre braços. A 1000 req/s em `orders` a vazão entregue foi 693 (Feign), 873 (RestTemplate) e 910 req/s (WebFlux). As barras dessas condições agora aparecem tracejadas e rotuladas. |
| `app_cpu_percent_median`, `app_cpu_percent_per_1000_rps`, `app_gc_pause_seconds_median`, `app_gc_pause_max_ms_median`, `app_threads_median` | É a leitura que continua válida em saturação. Ver a seção de resultados abaixo. |
| Cabeçalho do CSV pela união das chaves | Vinha de `Object.keys(rows[0])` com valores por `Object.values`: uma rodada com conjunto de campos diferente deslocaria silenciosamente as colunas. |
| Lista dos nomes das rodadas excluídas no HTML | Antes só aparecia a contagem. |
| Coluna de amostras retiradas na tabela de incidentes | Torna a exclusão ponto a ponto visível por condição. |

## O que depende da máquina, não do código

Estes itens **não** estão no repositório e precisam ser feitos antes da coleta. Sem eles,
parte dos problemas permanece.

1. **Sincronização de tempo do convidado.** Desative-a enquanto a coleta roda (serviço de
   integração de tempo do Hyper-V / WSL2 e `w32time`). É a origem compatível com as
   durações negativas de 1–2 ms observadas.
2. **Plano de energia em Alto Desempenho.** Em carga baixa o laboratório media cerca de
   1 ms a mais por requisição — inclusive no braço de controle `inventory` e no próprio
   tempo de bloqueio do k6, que caía de 0,020 ms a 200 req/s para 0,008 ms a 1000 req/s.
   Esse piso dependente da taxa é maior que toda a diferença medida entre MVC e WebFlux em
   SQL (0,1–0,6 ms). `Benchmark.ps1` registra o plano ativo em `metadata.json`.
3. **Fixação de núcleos.** Ver `compose.cpuset.yaml`, com a topologia a confirmar na
   máquina. Opcional, mas é candidato direto à dispersão entre repetições.
4. **Repetições.** Três repetições não sustentam as afirmações: `mvc-resttemplate/orders`
   a 1000 req/s teve p50 de 3,96, 31,8 e 277,7 ms. Para as células saturadas, use 10 ou
   mais e relate mediana e amplitude interquartil.

## Ordem sugerida da nova coleta

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Build.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Nightly.ps1 -Quick
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Run-Overnight.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Knee.ps1
```

`Knee.ps1` são 60 rodadas: escrita SQL (duas implementações) e pedidos (três clientes), em
500, 600, 700, 800, 900 e 1000 req/s, com duas repetições. Cerca de 150 minutos de carga.
Confirme no relatório que o aquecimento agora entrega a carga antes de interpretar
qualquer medição.

## Rodada de diagnóstico de 15 out. 2026 e a forma do aquecimento

A primeira rodada executada sob o protocolo 4 foi `mvc-feign/orders` a 1000 req/s, o pior
caso conhecido, em `results/20261015-002716-ccf398`. Ela confirmou que a instrumentação
nova funciona — `docker cp` das amostras, histograma do servidor com baldes clássicos,
timers do Hikari, heap de 512 MiB sem OOM — e os números já melhoraram frente a outubro:
951 req/s entregues contra 661–693, p95 de 672 ms contra 1351, duas respostas inválidas
contra cerca de 40 por rodada. Compatível com a troca de SerialGC/256 MiB por G1/512 MiB.

Mas as três janelas da medição revelaram um defeito do próprio protocolo 4:

| Janela | Conclusões | p95 |
|---|---|---|
| 0–30 s | 25.631 | 1030,69 ms |
| 30–60 s | 30.002 | 11,76 ms |
| 60–90 s | 29.995 | 23,31 ms |

O p95 da rodada era **inteiramente** o primeiro terço. Nas janelas 2 e 3 a aplicação fez
30 mil conclusões por 30 s, ou seja 1000 req/s com p95 de 12 ms: o Feign aguenta a carga
depois de aquecido. A causa estava no aquecimento, que ficou em p50 de 974 ms entregando
413 req/s. Com 500 VUs e latência de ~1 s, o gerador não consegue oferecer mais que
~513 req/s (500 ÷ 0,974): o aquecimento passou os 60 s travado num regime quebrado, sem
nunca atingir estado estável, e a medição começou fria.

A subida de 15 s não bastava porque aquecer **na taxa alvo** é autodestrutivo justamente
nas células acima do joelho. A forma passou a ser subida ao longo de 75% da janela mais
platô de 25% no alvo: a aplicação atravessa a faixa que consegue sustentar, compila e
enche os pools, e chega ao alvo aquecida. O platô mede se ela sustenta o alvo nesse
estado; `plateau_delivered_fraction` abaixo de 0,99 marca a rodada como `above_knee` e
derruba `comparable_latency` do grupo, porque ali o p95 é de um laço fechado de 500 VUs e
não de carga aberta.

Essa rodada **não** faz parte do conjunto de dados: usou a forma antiga de aquecimento e
serve só como diagnóstico. A forma fica registrada em `load_shape` e `warmup_shape`.

## Como a análise deve ser escrita

Com os dados de outubro, a leitura que se sustenta não é de latência, e sim de custo e
vazão. Em `orders` a 1000 req/s:

| braço | CPU da aplicação | vazão correta | CPU por requisição entregue | threads vivas |
|---|---|---|---|---|
| mvc-resttemplate | 116% | 873 req/s | 1,33 | 215 |
| webflux | 143% | 910 req/s | 1,57 | 21 |
| mvc-feign | 199,4% (máx. 210,3%) | 693 req/s | 2,87 | 215 |

O Feign ficou colado no teto da sua cota de dois núcleos, o que localiza o mecanismo por
trás do seu p95 de 1351 ms. Os números vêm de `resources.csv` e `jvm.jsonl` das próprias
rodadas; `report.mjs` agora calcula essas colunas automaticamente. Reproduzir a tabela com
dados do protocolo 4 antes de usá-la no artigo.

Nos cenários SQL puros é provável que as conclusões não sobrevivam: o efeito entre braços
(0,1–0,6 ms) é menor que o piso de ruído dependente da taxa (cerca de 1 ms). "Em consulta
por chave primária, sob este laboratório, não distinguimos as duas pilhas" é um resultado
legítimo e mais honesto que uma diferença de décimos de milissegundo.
