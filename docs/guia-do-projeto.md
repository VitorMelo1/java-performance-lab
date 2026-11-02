# Guia do projeto

Este repositório reúne duas APIs Java, os testes que as comparam e o artigo. As pastas têm funções diferentes; você não precisa abrir todos os arquivos para executar o projeto.

## Comece por estes três lugares

- **Artigo:** `docs/ArtigoCientificoJava-com-resultados.docx`. É o documento Word, com os autores, teoria, metodologia, gráficos e discussão. A versão atual apresenta a primeira coleta como exploratória e uma verificação diagnóstica separada. O reteste comparativo completo ainda precisa ser executado e analisado.
- **Código:** `mvc-jdbc/src/main/java` e `webflux-r2dbc/src/main/java`.
- **Comandos:** `README.md`. Para repetir as medições, use `scripts/Retest.ps1` conforme o README.

## O que é cada pasta da imagem

| Pasta | Para que serve |
|---|---|
| `.git` | Histórico e configuração local do Git. O Git administra essa pasta; você não a envia como arquivo ao GitHub. |
| `.github` | Configurações auxiliares de ferramentas ligadas ao repositório. Nesta máquina contém arquivos de modernização Java; não executa os testes de desempenho. Não há um workflow de CI pronto nesta pasta atualmente. |
| `mvc-jdbc` | API tradicional: Spring MVC, acesso ao PostgreSQL por JDBC e chamadas externas por RestTemplate ou OpenFeign. |
| `webflux-r2dbc` | API reativa: Spring WebFlux, PostgreSQL por R2DBC e chamadas externas por WebClient. |
| `infra` | Banco inicial e API auxiliar que simula a espera de uma chamada externa. |
| `benchmarks` | Programa do k6 que envia a carga e analisador dos resultados de cada rodada. |
| `scripts` | Comandos PowerShell para preparar, iniciar, testar e medir o laboratório. |
| `tests` | Testes de funcionamento das APIs e do protocolo de medição. |
| `results` | Saída bruta de cada execução. Cada subpasta com data é um lote; as subpastas internas são rodadas. Está ignorada no Git para evitar publicar grandes volumes de dados. |
| `docs` | Artigo Word, gráficos, guia e registros de metodologia e validação. |

## Por que tem um `pom` na raiz

O nome completo é **`pom.xml`**. O Explorador pode esconder `.xml` e mostrar o ícone do Edge por associação de arquivos. Isso não transforma o arquivo em uma página da internet.

POM significa *Project Object Model*. É a configuração que o **Maven**, ferramenta de compilação Java, lê.

- O `pom.xml` da raiz lista os módulos `mvc-jdbc` e `webflux-r2dbc`. Permite executar `mvn verify` na raiz e compilar os dois.
- O `pom.xml` dentro de cada módulo define suas próprias bibliotecas e a versão do Java. Cada API também pode ser compilada separadamente.
- O POM da raiz não é uma terceira aplicação.

Você pode abrir arquivos XML no VS Code. Para mostrar os nomes completos no Explorador do Windows, ative **Exibir > Mostrar > Extensões de nomes de arquivos**.

## Os outros arquivos da raiz

| Arquivo | Função |
|---|---|
| `compose.yaml` | Define os containers, portas, recursos e conexões do laboratório. |
| `.gitignore` | Diz ao Git quais arquivos locais não devem ser versionados, como `target`, resultados brutos e logs. |
| `README.md` | Página principal do projeto e manual de execução; o GitHub a mostra automaticamente. |

## Dentro de cada aplicação Java

| Caminho ou arquivo | Função |
|---|---|
| `src/main/java/.../Application.java` | Inicia a aplicação Spring. |
| `ApiController.java` | Define as rotas HTTP e suas respostas. |
| `ProductRepository.java` | Executa as operações no banco. |
| `Product.java`, `RemoteProduct.java`, `StockUpdate.java` | Representam os dados trocados pela API. |
| `ApiInput.java` | Valida as entradas recebidas. |
| Classes de cliente/configuração HTTP | Configuram RestTemplate, OpenFeign ou WebClient e seus limites. |
| `src/main/resources/application.properties` | Configurações de conexão, métricas e aplicação. |
| `src/test/java` | Testes unitários Java. |
| `Dockerfile` | Instruções para construir a imagem da API e executar o Java. |
| `target` | Arquivos gerados pelo Maven, quando a compilação ocorre nessa pasta. Não é código-fonte. |

## Scripts disponíveis

| Script | O que faz |
|---|---|
| `Build.ps1` | Constrói as imagens e executa os testes unitários Java durante o build. |
| `Start.ps1` | Liga uma variante para exploração manual. |
| `Test.ps1` | Verifica o protocolo, o analisador e o funcionamento das três variantes. |
| `Benchmark.ps1` | Executa um cenário ou conjunto de cenários com parâmetros escolhidos. |
| `Retest.ps1` | Executa o controle da API auxiliar e a comparação a 500 e 1.000 req/s em dois lotes. |
| `Nightly.ps1` | Matriz noturna de 72 rodadas: 200, 500 e 1.000 req/s, três repetições. |
| `Run-Overnight.ps1` | Encadeia build, contratos, ensaio curto e a matriz noturna. |
| `Knee.ps1` | Varre 500 a 1.000 req/s de 100 em 100 para localizar o ponto de saturação, que a matriz noturna não mede. |
| `Common.ps1` | Funções compartilhadas pelos outros scripts; não é um comando que você precisa executar sozinho. |

## Como ler os resultados sem abrir tudo

Comece por `results.csv` na pasta do lote e por `quality.txt` dentro de cada rodada nova.

- `row.json` e `summary.json`: resumo das medidas do k6.
- `samples.json.gz`: todas as amostras brutas, compactadas para análise posterior.
- `quality.txt`: explicação das contagens e avisos em português.
- `quality.json`: os mesmos diagnósticos em formato para programas, incluindo os percentis recalculados das amostras brutas e as durações impossíveis retiradas ponto a ponto.
- `resources.jsonl` e `jvm.jsonl`: medições de CPU, memória, threads e pausas de GC.
- `console.log`, `services.log` e arquivos do coletor: diagnóstico do que aconteceu. `services.log` registra, uma vez por rodada, qual coletor de lixo a JVM ativou.
- `warmup`: etapa de aquecimento, separada das medidas principais, com coleta de recursos própria.
- `report/groups.csv`: além das medianas, traz a fração da carga entregue, a CPU por 1.000 respostas/s e o tempo em pausas de GC. Onde a carga não foi entregue, compare vazão e CPU, não o p95.
- `metadata.json`, `order.json`, `containers.json`, `generator.json`, `compose-resolved.yaml` e `source-hashes.csv`: registram parâmetros, ordem, imagens e código para permitir reprodução.

`insuficiente` é esperado no ensaio Quick, que dura apenas 5 segundos. `variacao_detectada` indica que as janelas da rodada diferiram além da regra de triagem. `sem_alerta` significa apenas que essa regra não apontou variação; não certifica que o experimento inteiro está validado.

## O que vai para o GitHub e o que vai para o professor

Para o GitHub, versione o código, scripts, testes, configurações e documentação. O `.gitignore` já exclui arquivos de compilação e resultados brutos. Para compartilhar os dados experimentais depois, compacte o lote escolhido separadamente.

Para a entrega do artigo, o arquivo principal é o **DOCX em `docs`**. O professor não precisa receber todas as pastas do código como se fossem partes do texto do artigo. O link do repositório pode acompanhar o documento quando solicitado.
