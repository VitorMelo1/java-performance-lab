# Java Performance Lab

<!-- publication-links:start -->
## Publicação e código

Abra [PUBLICAR.html](PUBLICAR.html) para encontrar os arquivos e copiar os campos do Zenodo. O [guia de publicação](docs/publicacao/COMO-PUBLICAR.md) explica como vincular o GitHub e guardar o comprovante. Depósito público e endereço do repositório ainda pendentes; nenhum DOI é presumido.

<!-- publication-links:end -->

**Onde começar:** abra [GRAFICOS.html](GRAFICOS.html), na raiz do projeto. A central reúne as coletas e apresenta gráficos por cenário, além do p95 de cada repetição. Para entender as pastas, consulte o [guia do projeto](docs/guia-do-projeto.md). As APIs ficam em `mvc-jdbc` e `webflux-r2dbc`; `stock-service` é a dependência comum de estoque.

O arquivo mostrado como **pom** no Windows é `pom.xml`: a configuração do Maven que permite compilar os dois projetos pela raiz. A extensão está oculta e o ícone do Edge é apenas a associação do Windows. Não é uma terceira aplicação.

| Onde | Conteúdo |
|---|---|
| `mvc-jdbc`, `webflux-r2dbc` | As duas APIs Java |
| `stock-service` | Serviço de estoque usado no cenário de pedidos |
| `infra` | PostgreSQL e API auxiliar |
| `benchmarks`, `scripts`, `tests` | Carga, comandos e verificações |
| `results` | Dados brutos gerados pelas execuções; ignorados pelo Git |
| `docs` | Artigo e documentação; gráficos das execuções ficam em `results/<lote>/report` |
| `.git`, `.github` | Histórico Git e configurações auxiliares de ferramentas |
| `compose.yaml`, `pom.xml`, `.gitignore` | Configurações do Docker, Maven e Git |
| `compose.cpuset.yaml` | Fixação opcional de núcleos; não aplicada por padrão |

**Estado da coleta:** o lote `20261015-011234-1ceec5` terminou 72/72 rodadas com protocolo 4 e relógio corrigido: 3.672.051 requisições observadas, todas corretas na medição; zero descartes e zero amostras excluídas. Há nove alertas temporais e 18 falhas no aquecimento do Feign. Consulte as ressalvas no relatório. Os lotes anteriores permanecem separados.

**Estado do artigo (01/11/2026):** revisão em [PDF](docs/entrega-artigo/Artigo-Spring-MVC-WebFlux.pdf) e [Word](docs/entrega-artigo/Artigo-Spring-MVC-WebFlux.docx), com [sete gráficos explicados](docs/entrega-artigo/graficos.html), [suplemento](docs/entrega-artigo/Material-suplementar.zip) e [dados brutos](docs/entrega-artigo/Dados-brutos.zip). São 282 rodadas principais e 20 testes curtos preservados. A matriz revisada de 31/10 teve 72 rodadas, 3.672.060 respostas corretas e zero descartes de medição; seis rodadas tiveram alerta temporal. JVM, transporte Feign e plano de energia são discriminados por coleta. As 175 novas séries foram conferidas a partir das amostras; 355 pontos dos gráficos foram verificados. Abra [ARTIGO.html](ARTIGO.html). Depósito público ainda pendente.

**Coleta complementar:** a sessão A terminou 30/30 rodadas e foi incorporada como análise separada ao artigo. A sessão B não consta dos lotes disponíveis e não é apresentada como executada. Os comandos abaixo são opções para novos estudos; não é necessário iniciar outra coleta para gerar esta versão do documento.

**Para a coleta completa no CMD**, com Docker Desktop aberto:

```bat
cd /d "C:\Faculdade\codes\ArtigoCientifico\Analise de desempenho - Spring WebFlux-R2DBC vs Spring MVC-JDBC"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Run-Overnight.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Knee.ps1
```

`Knee.ps1` varre 500, 600, 700, 800, 900 e 1.000 req/s em escrita SQL e pedidos, com duas repetições: 60 rodadas, cerca de 150 minutos de carga. A matriz noturna mede 200, 500 e 1.000 req/s, e nos lotes de outubro 500 estava ocioso enquanto 1.000 já havia colapsado, sem nenhum ponto entre os dois.

Esse comando compila, testa os contratos, executa uma checagem curta e inicia a matriz noturna. São 72 rodadas: leitura SQL, escrita SQL, pedidos entre serviços e controle do estoque; taxas de 200, 500 e 1.000 req/s, três repetições, 60 s de aquecimento e 90 s de medição. O orçamento de 240 minutos vale para a etapa noturna; build, contratos e checagem curta acrescentam tempo. Para executar somente a checagem curta, use `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Nightly.ps1 -Quick`. Ela não serve como resultado científico. `Retest.ps1` continua disponível para os cenários HTTP/SQL anteriores e não executa a matriz noturna de 72 rodadas.

Dois projetos Java independentes para o artigo de Vitor Martins Melo, Athos Lial Passos e Jonatan Mariano da Silva.

| Projeto | Servidor / banco | Cliente HTTP | Porta local |
|---|---|---|---|
| mvc-jdbc | Spring MVC / JDBC / PostgreSQL | RestTemplate | 18081 |
| mvc-jdbc, outro modo | Spring MVC / JDBC / PostgreSQL | OpenFeign | 18082 |
| webflux-r2dbc | Spring WebFlux / R2DBC / PostgreSQL | WebClient | 18083 |

**A sugestão do professor foi aplicada em um experimento HTTP adicional.** RestTemplate e OpenFeign são bloqueantes. Colocá-los no event loop do WebFlux distorceria o experimento. A aplicação reativa usa WebClient, sem chamadas a `block()`, JDBC ou `Thread.sleep()`.

O tema original continua atendido por cenários separados de leitura e escrita SQL. Os testes HTTP não consultam o banco. No cenário SQL, testar MVC com Feign novamente seria repetir a mesma implementação JDBC.

## 1. Começar no Windows

Instale/abra o Docker Desktop com containers Linux e Docker Compose. Para o fluxo Docker, não é necessário instalar Java, Maven, Node ou k6 no Windows. Reserve recursos suficientes para o Docker; 6 GB de RAM e 4 CPUs são um ponto inicial para funcionamento, não uma garantia de capacidade para carga alta.

No CMD ou PowerShell, entre **na pasta que contém compose.yaml**. Para preparar uma instalação nova e conferir seu funcionamento:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Build.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Retest.ps1 -Quick
```

A política Bypass vale apenas para esse processo. O primeiro build baixa dependências e pode demorar. Build executa os testes unitários das duas aplicações. Test executa o mesmo contrato nas três variantes, incluindo PostgreSQL real, falhas HTTP, timeout e 40 chamadas simultâneas. Quick verifica a coleta com carga curta; **não fornece evidência científica de desempenho**.

Não execute dois scripts de teste/coleta simultaneamente. Eles usam o mesmo laboratório e restauram os dados sintéticos do seu PostgreSQL. Outros projetos Docker não são parados por esses scripts.

## 2. Abrir cada aplicação para explorar o código

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Start.ps1 -Variant mvc-resttemplate
powershell -ExecutionPolicy Bypass -File .\scripts\Start.ps1 -Variant mvc-feign
powershell -ExecutionPolicy Bypass -File .\scripts\Start.ps1 -Variant webflux
```

Execute um comando por vez. Start para as outras variantes para evitar comparação com aplicações concorrentes. Ao iniciar outra variante, a anterior deixa de responder.

Exemplos, com MVC/RestTemplate ligado:

```powershell
Invoke-RestMethod http://localhost:18081/api/products/1
Invoke-RestMethod 'http://localhost:18081/api/remote/1?delayMs=100'
Invoke-RestMethod http://localhost:18081/api/products/1/stock -Method Put -ContentType 'application/json' -Body '{"stock":17}'
```

| Rota | Comportamento |
|---|---|
| GET /api/products/{id} | Um SELECT por chave primária |
| PUT /api/products/{id}/stock | Um UPDATE ... RETURNING, corpo {"stock":100} |
| GET /api/remote/{id}?delayMs=100 | Uma chamada à API auxiliar; atraso entre 0 e 1000 ms |
| GET /actuator/health | Prontidão, incluindo acesso ao PostgreSQL |
| GET /actuator/metrics | Métricas JVM para diagnóstico |

São 10.000 produtos determinísticos, sem ORM, cache de aplicação ou paginação. Retornos de sucesso têm o mesmo JSON. IDs inexistentes no banco retornam 404; IDs não positivos e estoque inválido retornam 400. Falhas/timeout do upstream retornam 502. O corpo de erro padrão dos frameworks não é objeto da comparação. IDs remotos 99998 e 99999 são reservados para simular 503 e atraso de 3,5 segundos; não aparecem no benchmark.

## 3. Fazer as medições

Comece com uma calibração curta e confira erros, descartes e recursos. Exemplo, em uma sessão PowerShell aberta na pasta:

```powershell
.\scripts\Benchmark.ps1 -Scenario http -Rates 50,200,500,1000 -Repetitions 3 -Seconds 120 -WarmupSeconds 60 -DelayMs 100
.\scripts\Benchmark.ps1 -Scenario db-read -Rates 50,200,500,1000 -Repetitions 3 -Seconds 120 -WarmupSeconds 60
.\scripts\Benchmark.ps1 -Scenario db-write -Rates 50,200,500,1000 -Repetitions 3 -Seconds 120 -WarmupSeconds 60
```

Se o Windows bloquear scripts nessa sessão, use antes `Set-ExecutionPolicy -Scope Process Bypass`; isso não altera a política permanente. Para arrays como Rates, use os comandos acima dentro do PowerShell.

- HTTP compara as três variantes; SQL compara MVC/JDBC e WebFlux/R2DBC.
- Use também atrasos 0 e 300 ms em lotes separados para examinar a influência da espera de I/O.
- `-Scenario all` executa HTTP, leitura e escrita. Uma rodada padrão completa pode levar mais de uma hora; comece com Quick.
- `-MaxVus 500` fixa a reserva e o limite de usuários virtuais. **Rate significa requisições oferecidas por segundo, não usuários simultâneos.** A concorrência efetiva depende do tempo de resposta; `allocated_vus_max` informa a reserva do gerador, não requisições simultâneas. Se houver dropped_iterations, não conclua que a aplicação recebeu a taxa configurada.
- Aumente MaxVus apenas depois de verificar CPU/RAM do gerador. Não mude o limite entre variantes de um mesmo conjunto comparativo.
- As condições são embaralhadas com semente registrada. Cada rodada reinicia a aplicação, aquece a JVM em processo separado de k6 e só depois mede. Os resultados de aquecimento ficam separados.
- Antes de cada teste SQL os dados são recriados e analisados, e em `db-write` isso acontece **também depois do aquecimento**: a 1.000 req/s o aquecimento fazia ~60 mil UPDATEs em 10 mil linhas, e a medição começava com a tabela carregada de tuplas mortas, com autovacuum podendo disparar dentro da janela medida.
- O UPDATE grava um valor que varia por iteração (`100 + iteração % 401`), de modo que a linha realmente muda e o PostgreSQL produz nova versão e WAL. No protocolo 3 ele reescrevia o mesmo 100 do povoamento.
- O aquecimento sobe a carga ao longo de 75% da janela e termina com um platô de 25% na taxa alvo; a medição usa taxa constante. Antes, aquecer direto na taxa alvo não entregava a carga, e a aplicação entrava na medição fria: na rodada de diagnóstico do Feign a 1.000 req/s o p95 foi 1.030 ms no primeiro terço contra 11,8 ms no segundo. O platô informa se a aplicação sustenta o alvo já aquecida — `plateau_delivered_fraction` abaixo de 0,99 marca a condição como acima do joelho e o p95 dela deixa de ser comparável entre braços. Aumentar a duração não garante estabilização: examine as janelas de `quality.txt` e as amostras brutas.
- `-Variant webflux` ou outra variante válida permite diagnóstico isolado; não substitui a comparação de todos os braços. `-PlanOnly` mostra o plano JSON sem iniciar Docker nem criar dados.
- Não use os números de Quick em gráficos conclusivos.

A API auxiliar também pode ser medida diretamente:

```powershell
.\scripts\Benchmark.ps1 -Scenario upstream -Rates 50,200,500,1000 -DelayMs 100
```

Esse controle verifica se ela ou o gerador limitam o teste. Ele não substitui os três braços principais.

## 4. O que me enviar

Cada coleta cria uma pasta em `results/<data-hora-id>/`. **Envie essa pasta inteira compactada**, incluindo:

| Arquivo | Conteúdo |
|---|---|
| results.csv | Uma linha por rodada: taxa, duração, p50/p95/p99, erros, descartes e vazão |
| metadata.json, order.json | Parâmetros, ambiente e ordem das rodadas |
| compose-resolved.yaml, source-hashes.csv | Configuração e hashes do código |
| */containers.json | IDs de imagens e limites dos containers usados |
| */generator.json | Imagem, limites e estado final do container k6 |
| */summary.json, row.json | Resumos originais do k6 e extração tabular |
| */quality.json, quality.txt | Verificação das contagens e triagem de variação temporal no protocolo novo |
| */samples.json.gz | Amostras temporais brutas compactadas |
| */resources.jsonl | CPU, memória e I/O de aplicação, PostgreSQL, upstream e k6 |
| */jvm.jsonl | Memória, threads, CPU e pausas de GC da JVM |
| */console.log, services.log, collector.log | Diagnóstico de falhas |
| */warmup/ | Aquecimento, excluído do resumo principal |

Depois usaremos as medições para construir gráficos e discutir os resultados, sem antecipar vencedor. Não envie senhas reais: este laboratório usa apenas credenciais locais fictícias; os artefatos incluem metadados do computador e containers do laboratório.

O relatório de qualidade compara três janelas iguais da medição. Sinaliza variação se a amplitude dos p95 ultrapassar o maior entre 5 ms e 20% da mediana, ou se a amplitude das contagens ultrapassar 10% da mediana. Exige pelo menos 60 s e 30 amostras por janela; por isso, Quick recebe `insuficiente`. Essa é uma regra de triagem declarada, não um teste estatístico de estacionariedade. `sem_alerta` não certifica o experimento. Falhas e carga não iniciada são informadas separadamente, mesmo sem alerta temporal.

## 5. Controles e limitações

Mesmos recursos por aplicação: 2 CPUs de cota, 1 GiB de memória de container, heap Java fixo de 512 MiB, **G1 explicitamente selecionado**, Java 21, 20 conexões SQL e 100 conexões HTTP. MVC usa até 200 threads de plataforma; virtual threads estão explicitamente desativadas. A comparação não responde como MVC com virtual threads se comportaria.

**Imagens fixadas por digest.** Os três `Dockerfile` referenciam imagens por digest, não por tag móvel:

```dockerfile
FROM maven@sha256:3a4ab3276a087bf276f79cae96b1af04f53731bec53fb2e651aca79e4b10211e AS build
FROM eclipse-temurin@sha256:9603446cf51296842eab342514857cf7ab55a8891cd564e6c68ec237fae65a16
```

O digest de execução corresponde à tag imutável `21.0.12.1_1-jre-jammy` e entrega `Temurin-21.0.12.1+1-LTS`, a mesma JVM dos lotes publicados — registrada por célula na métrica `jvm_info` de `prometheus-before.txt` e `prometheus-after.txt`, e no suplemento como `"java": "jdk-21.0.12.1+1"` em `ambiente/<lote>.json`; o de compilação corresponde a `3.9.9-eclipse-temurin-21`. A fixação foi feita depois de reconstruções que passaram a usar `Temurin-21.0.13+9-LTS`, já registrada em `jvm_info` no lote completo de 30/10 e também em 31/10. Os Dockerfiles ainda usavam tags móveis, embora seus hashes não tivessem mudado. Não se atribui a diferença de latência à JVM isoladamente: 30 e 31/10 já tinham a mesma versão e planos de energia diferentes.

**A fixação garante a mesma JVM, não a mesma latência.** No próprio lote de 01/11, com JVM, código e carga idênticos entre as três repetições, o p95 de `orders` a 1.000 req/s foi de 586 ms, 178 ms e 25 ms, com 2.169, 316 e zero descartes. O `stock-service` saturou na primeira repetição — cota de 1 CPU e `ActiveProcessorCount=1`, mediana de 101% e máximo de 106% — e foi liberando folga nas seguintes, enquanto o braço cliente ficava em 112% de uma cota de 200%: o padrão é compatível com contenção no upstream compartilhado, mas não houve intervenção isolada que demonstre causalidade. No lote de 15/10 esse mesmo serviço operava entre 62 e 70% de mediana nas nove células de 1.000 req/s. Oscilações dessa ordem no estado da máquina impedem atribuir a diferença de 8 a 40% à troca de JVM isoladamente. Antes de comparar qualquer p95, leia a fração entregue e a CPU por componente; repetições de uma mesma célula divergem quando um serviço compartilhado satura.

No protocolo 3 nenhum coletor de lixo era especificado e o heap era de 256 MiB: com 768 MiB de container a ergonomia da JVM selecionava SerialGC, e o braço reativo pagava mais por isso (170 pausas e 5,08 s totais contra 88 pausas e 1,00 s do MVC em `orders` a 1000 req/s, com pausa máxima de 206 ms). Heap igual não equivale a tratamento justo. O coletor ativo passa a ser registrado em `services.log`, e tempo de GC, threads vivas e CPU por requisição entram em `rounds.csv` e `groups.csv`.

`cpus: 2.0` é cota de tempo, não afinidade de núcleo. Para fixar núcleos use `compose.cpuset.yaml`, confirmando antes a topologia da máquina.

RestTemplate e Feign usam Apache HttpClient 5 com o mesmo pool de 100 conexões, sem retries automáticos ou redirects. No braço Feign esse transporte é fixado por um bean `feign.Client` explícito sobre o `CloseableHttpClient` compartilhado: sem ele, a autoconfiguração HC5 do OpenFeign recua quando já existe um `CloseableHttpClient` no contexto e o Feign cai no `Client.Default` (HttpURLConnection). **Ressalva de reprodutibilidade:** os lotes publicados (15/10, 20/10 e diagnóstico de 29/10) foram coletados antes desse bean explícito. Naquele estado a autoconfiguração HC5 recuava e nenhum `feign.Client` era registrado — comportamento confirmado pelo teste `FeignClientWiringTest` —, de modo que o braço Feign usava o `Client.Default` (HttpURLConnection), não o pool HC5. Trate os dois braços MVC como transportes distintos nesses dados. **A fiação do transporte não explica as falhas de aquecimento.** Uma coleta de 72 rodadas em 30/10, já com o bean explícito e com o registro de causa em `RemoteErrors`, manteve as falhas concentradas no braço Feign (186 falhas em 8 de 9 rodadas; zero em todos os outros braços) e registrou uma causa única: `feign.codec.DecodeException: 'messageConverters' must not be empty`, sem um só tempo limite de socket, reset de conexão ou resposta ausente. O padrão é de corrida na inicialização do decodificador no contexto filho do OpenFeign: dispara no começo da carga, também aparece no teste curto. Na matriz completa, houve 117 falhas a 200 req/s (115, 0 e 2 por rodada), 23 a 500 e 46 a 1.000. Portanto, não há crescimento monotônico das contagens com a taxa. Não é efeito de latência nem de transporte, o que explica o p95 de regime permanente permanecer comparável ao do RestTemplate. Para os lotes publicados a causa continua não registrada, porque o manipulador de exceções daquela época descartava o motivo antes de devolver o 502. **Causa e correção:** `FeignHttpMessageConverters` (spring-cloud-openfeign-core 5.0.1) guarda a lista de conversores num campo não final e não volátil, preenchido só na primeira chamada a `getConverters()` — método que o `SpringDecoder` invoca a cada resposta decodificada. Sob carga concorrente várias threads entram nessa primeira chamada sem barreira de publicação e parte delas lê a lista ainda vazia, o que produz a exceção. `FeignDecoderWarmup` fecha a janela inicializando os conversores de cada contexto filho em `afterSingletonsInstantiated()`, antes de `finishRefresh()` criar as threads do servidor. Validação em 30/10 na mesma célula onde o erro era recorrente (orders, 1.000 req/s, 3 repetições): zero falhas de decodificação e zero respostas com erro em cerca de 119 mil requisições de aquecimento, contra 14, 8 e 24 falhas nas três repetições anteriores. **Validação na JVM dos lotes publicados (01/11, lote `20261101-014109-c2d17d`):** a matriz Feign completa — 200, 500 e 1.000 req/s, três repetições — repetida sobre `Temurin-21.0.12.1+1-LTS` registrou zero falhas em 198.890 requisições de aquecimento e zero erros nas 456.522 requisições de medição, contra as 18 falhas do lote de 15/10 na mesma JVM e na mesma matriz. A primeira repetição a 1.000 req/s desse lote degradou por saturação do `stock-service` (p95 de 586 ms e 2.169 descartes, contra 8 ms e zero descartes na célula publicada equivalente), de modo que a janela da corrida foi exercida com mais enfileiramento do que nas rodadas que produziram as falhas originais. Esse lote vale como validação da correção, não como dado de latência. **Como contar as falhas:** o contador é `requests` menos `successful_requests` em `warmup/row.json`, por célula. Contar linhas de `services.log` subconta — a captura do `docker compose logs` trunca e devolve 72 em vez de 186 no lote de 30/10, perdendo inteiro o pico de 115 falhas em `orders` a 200 req/s, repetição 1. WebClient usa Reactor Netty, também sem retries ou redirects. Tempo limite de aquisição HTTP: 2 s; conexão: 1 s; resposta: 2 s. São limites por fase, não um prazo global único. Há diferenças inerentes de implementação das filas: Reactor permite até 1.000 aquisições HTTP pendentes; no MVC a capacidade de espera também é limitada pelos workers. O resultado compara **pilhas completas**, não isola a sintaxe de um cliente.

SQL usa as mesmas consultas, schema, quantidade de linhas, índices e pool máximo. A role PostgreSQL limita statements a 2 s. HikariCP e R2DBC não têm todas as mesmas políticas internas; documente essa diferença. Um único pool/banco pode limitar ambas as arquiteturas.

O executor k6 usa modelo aberto: tenta manter a taxa mesmo se a aplicação desacelerar. Erros e iterações descartadas ficam registrados. Código k6 99 significa falha dos critérios de erro (<1%) ou entrega de carga (zero descartes); a rodada é preservada, não apagada. Erro de aplicação sob saturação é resultado; descarte pode indicar VUs insuficientes ou gargalo no gerador e exige investigação.

No protocolo 4, `request_latency_ms` usa `Response.timings.duration`: envio, espera e recebimento HTTP, excluindo bloqueio e estabelecimento da conexão. O bloqueio passa a ter métrica própria (`request_blocked_ms`, com p50/p95/p99) e a soma observada pelo cliente também (`client_latency_ms`); sem isso, o enfileiramento no gerador sob saturação ficava invisível na métrica principal. `request_wall_ms` pertence ao protocolo 2 e não deve ser misturado. CSV separa latência de todas as respostas da latência dos sucessos para que erros rápidos não pareçam uma melhoria. Vazões usam o tempo real da execução, incluindo drenagem final; duração agendada e tempo decorrido ficam separados. Os percentis são por rodada: **não faça média de p99 como se fosse o p99 de todas as requisições**.

Os percentis do relatório vêm das amostras brutas analisadas, pela mesma fórmula em toda rodada; o resumo do k6 fica preservado em `k6_latency_p50/p95/p99_ms` para conferência. Durações impossíveis (negativas) são retiradas ponto a ponto, no máximo 10 por rodada e 0,1% das requisições, e somente quando `http_req_duration` do próprio k6 registra os mesmos valores; acima disso a rodada é rejeitada. No protocolo 3 a primeira amostra negativa descartava a repetição inteira, o que custou duas das três rodadas `mvc-resttemplate/db-read` a 1000 req/s e deixou n=1 ao lado de n=3.

**Onde houver descartes, o p95 não é comparável entre braços**, porque a carga entregue difere: a 1000 req/s em `orders` a vazão correta foi 693 (Feign), 873 (RestTemplate) e 910 req/s (WebFlux). Nessas condições leia vazão alcançada e CPU por requisição. O relatório marca essas barras com traço e informa a fração entregue por condição.

Amostras Docker são tomadas a cada aproximadamente 3–6 s, dependendo do tempo de coleta. CPU 100% equivale aproximadamente a um core; uma aplicação limitada a dois cores pode chegar perto de 200%. Memória de container e heap usado são métricas diferentes. Métricas JVM incluem também memória não heap e a soma de pausas de GC desde o início; para GC por intervalo use diferenças entre amostras.

Docker Desktop, PostgreSQL, upstream e k6 dividem a máquina. Feche outros workloads antes da coleta formal; o script registra quantos containers externos estavam ativos, mas não os encerra. Limites de container iguais não equivalem a hardware dedicado. Para cargas maiores, separe o gerador em outra máquina e registre as mudanças. Meça o upstream diretamente e observe recursos de todos os componentes. Só depois disso atribua um limite à aplicação Java.

A proposta é uma bancada acadêmica local, sem autenticação e com Actuator acessível apenas nas portas ligadas a 127.0.0.1. Não publique esses containers diretamente na internet.

## 6. Organização e desenvolvimento

```text
mvc-jdbc/           projeto Maven independente: MVC, JDBC, RestTemplate, Feign
webflux-r2dbc/      projeto Maven independente: WebFlux, R2DBC, WebClient
stock-service/      serviço de estoque fixo (MVC/JDBC), comum a todos os braços
infra/              schema PostgreSQL, API auxiliar Node e o build do k6 corrigido
benchmarks/         carga k6, verificação por rodada, relatório e sensibilidade
scripts/            build, teste, inicialização e coleta no PowerShell
tests/              contrato HTTP e testes dos próprios scripts de análise
docs/               plano, protocolos e registro de validação
```

Para desenvolvimento local com JDK 21 e Maven: `mvn verify` na raiz compila/testa os dois; `mvn -f mvc-jdbc/pom.xml verify` e `mvn -f webflux-r2dbc/pom.xml verify` funcionam separadamente. Execução local também precisa de PostgreSQL/upstream e variáveis de conexão apropriadas; o Compose é o caminho pronto, sem depender dessas instalações no host.

Versões da bancada: Spring Boot 4.0.3, Spring Cloud 2025.1.1 (Feign), PostgreSQL 17.4, Node 22.14.0, k6 1.0.0. Foram fixadas para reprodução; não são apresentadas como as versões mais recentes. Imagens Java 21 recebem atualizações do fornecedor: registre os IDs coletados e não misture imagens diferentes no mesmo estudo. RestTemplate está depreciado no Spring Framework 7 usado aqui e OpenFeign está em manutenção funcional; foram incluídos deliberadamente para a comparação sugerida pelo professor. Para um produto novo, essa decisão exigiria avaliar as alternativas atuais.

Para encerrar apenas este laboratório, na pasta do projeto:

```powershell
docker compose --profile "*" down
```

O banco permanece no volume do laboratório. Não há comando de remoção de volumes nos scripts.

## Fontes técnicas usadas

- [Spring WebFlux: modelo de concorrência e desempenho](https://docs.spring.io/spring-framework/reference/web/webflux/new-framework.html).
- [Clientes REST do Spring: RestTemplate e WebClient](https://docs.spring.io/spring-framework/reference/integration/rest-clients.html).
- [OpenFeign: configuração e ausência de suporte reativo](https://docs.spring.io/spring-cloud-openfeign/reference/spring-cloud-openfeign.html).
- [Spring Cloud: compatibilidade entre versões](https://spring.io/projects/spring-cloud).
- [R2DBC 1.0: especificação](https://r2dbc.io/spec/1.0.0.RELEASE/spec/html/).
- [k6: modelos aberto e fechado](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/).
- [k6: exportação das amostras JSON/GZip](https://grafana.com/docs/k6/latest/results-output/real-time/json/).

