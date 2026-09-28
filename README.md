# Java Performance Lab

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

Extraia o ZIP e abra o PowerShell **na pasta que contém compose.yaml**:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Build.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\Test.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\Benchmark.ps1 -Quick
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
.\scripts\Benchmark.ps1 -Scenario http -Rates 50,200,500,1000 -Repetitions 3 -Seconds 45 -WarmupSeconds 15 -DelayMs 100
.\scripts\Benchmark.ps1 -Scenario db-read -Rates 50,200,500,1000 -Repetitions 3 -Seconds 45 -WarmupSeconds 15
.\scripts\Benchmark.ps1 -Scenario db-write -Rates 50,200,500,1000 -Repetitions 3 -Seconds 45 -WarmupSeconds 15
```

Se o Windows bloquear scripts nessa sessão, use antes `Set-ExecutionPolicy -Scope Process Bypass`; isso não altera a política permanente. Para arrays como Rates, use os comandos acima dentro do PowerShell.

- HTTP compara as três variantes; SQL compara MVC/JDBC e WebFlux/R2DBC.
- Use também atrasos 0 e 300 ms em lotes separados para examinar a influência da espera de I/O.
- `-Scenario all` executa HTTP, leitura e escrita. Uma rodada padrão completa pode levar mais de uma hora; comece com Quick.
- `-MaxVus 500` fixa a reserva e o limite de usuários virtuais. **Rate significa requisições oferecidas por segundo, não usuários simultâneos.** A concorrência efetiva depende do tempo de resposta; `allocated_vus_max` informa a reserva do gerador, não requisições simultâneas. Se houver dropped_iterations, não conclua que a aplicação recebeu a taxa configurada.
- Aumente MaxVus apenas depois de verificar CPU/RAM do gerador. Não mude o limite entre variantes de um mesmo conjunto comparativo.
- As condições são embaralhadas com semente registrada. Cada rodada reinicia a aplicação, aquece a JVM em processo separado de k6 e só depois mede. Os resultados de aquecimento ficam separados.
- Antes de cada teste SQL, os dados são recriados e analisados. O UPDATE usa estoque 100, tornando o conteúdo previsível; o PostgreSQL ainda executa a escrita e produz versões de linha/WAL.
- Para um artigo, ajuste o aquecimento após observar estabilização. Os 15 segundos padrão são um começo operacional; não provam que JIT, pools e caches estabilizaram.
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
| */samples.json.gz | Amostras temporais brutas compactadas |
| */resources.jsonl | CPU, memória e I/O de aplicação, PostgreSQL, upstream e k6 |
| */jvm.jsonl | Memória, threads, CPU e pausas de GC da JVM |
| */console.log, services.log, collector.log | Diagnóstico de falhas |
| */warmup/ | Aquecimento, excluído do resumo principal |

Depois usaremos as medições para construir gráficos e discutir os resultados, sem antecipar vencedor. Não envie senhas reais: este laboratório usa apenas credenciais locais fictícias; os artefatos incluem metadados do computador e containers do laboratório.

## 5. Controles e limitações

Mesmos recursos por aplicação: 2 CPUs, 768 MiB de memória de container, heap Java fixo de 256 MiB, Java 21, 20 conexões SQL e 100 conexões HTTP. MVC usa até 200 threads de plataforma; virtual threads estão explicitamente desativadas. A comparação não responde como MVC com virtual threads se comportaria.

RestTemplate e Feign usam Apache HttpClient 5 com o mesmo pool, sem retries automáticos ou redirects. WebClient usa Reactor Netty, também sem retries ou redirects. Tempo limite de aquisição HTTP: 2 s; conexão: 1 s; resposta: 2 s. São limites por fase, não um prazo global único. Há diferenças inerentes de implementação das filas: Reactor permite até 1.000 aquisições HTTP pendentes; no MVC a capacidade de espera também é limitada pelos workers. O resultado compara **pilhas completas**, não isola a sintaxe de um cliente.

SQL usa as mesmas consultas, schema, quantidade de linhas, índices e pool máximo. A role PostgreSQL limita statements a 2 s. HikariCP e R2DBC não têm todas as mesmas políticas internas; documente essa diferença. Um único pool/banco pode limitar ambas as arquiteturas.

O executor k6 usa modelo aberto: tenta manter a taxa mesmo se a aplicação desacelerar. Erros e iterações descartadas ficam registrados. Código k6 99 significa falha dos critérios de erro (<1%) ou entrega de carga (zero descartes); a rodada é preservada, não apagada. Erro de aplicação sob saturação é resultado; descarte pode indicar VUs insuficientes ou gargalo no gerador e exige investigação.

`request_wall_ms` mede a chamada vista pelo gerador, incluindo bloqueio/conexão; `http_req_duration` é a duração HTTP do k6. CSV separa latência de todas as respostas da latência dos sucessos para que erros rápidos não pareçam uma melhoria. Vazões usam o tempo real da execução, incluindo drenagem final; duração agendada e tempo decorrido ficam separados. Os percentis são por rodada: **não faça média de p99 como se fosse o p99 de todas as requisições**.

Amostras Docker são tomadas a cada aproximadamente 3–6 s, dependendo do tempo de coleta. CPU 100% equivale aproximadamente a um core; uma aplicação limitada a dois cores pode chegar perto de 200%. Memória de container e heap usado são métricas diferentes. Métricas JVM incluem também memória não heap e a soma de pausas de GC desde o início; para GC por intervalo use diferenças entre amostras.

Docker Desktop, PostgreSQL, upstream e k6 dividem a máquina. Feche outros workloads antes da coleta formal; o script registra quantos containers externos estavam ativos, mas não os encerra. Limites de container iguais não equivalem a hardware dedicado. Para cargas maiores, separe o gerador em outra máquina e registre as mudanças. Meça o upstream diretamente e observe recursos de todos os componentes. Só depois disso atribua um limite à aplicação Java.

A proposta é uma bancada acadêmica local, sem autenticação e com Actuator acessível apenas nas portas ligadas a 127.0.0.1. Não publique esses containers diretamente na internet.

## 6. Organização e desenvolvimento

```text
mvc-jdbc/           projeto Maven independente: MVC, JDBC, RestTemplate, Feign
webflux-r2dbc/      projeto Maven independente: WebFlux, R2DBC, WebClient
infra/             schema PostgreSQL e API auxiliar Node (sem bibliotecas externas)
benchmarks/        carga e exportação k6
scripts/           build, teste, inicialização e coleta no PowerShell
tests/             contrato HTTP compartilhado, executado com Node no Docker
docs/              plano e registro de validação
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

