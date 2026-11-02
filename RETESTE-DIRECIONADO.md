# Diagnostico antes de publicar

Execute no **Prompt de Comando (CMD)**, com Docker Desktop aberto e Engine running:

```bat
cd /d "C:\Faculdade\codes\ArtigoCientifico\Analise de desempenho - Spring WebFlux-R2DBC vs Spring MVC-JDBC"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Diagnose-WebFlux.ps1"
```

O comando confere imagens e carga, executa quatro rodadas curtas (incluindo exportacao JFR), e so depois inicia o diagnostico principal. Nao recompila nem baixa imagens. Se faltar imagem historica essencial, para com mensagem explicita. Nao use Build.ps1 ou Run-Overnight.ps1 para este diagnostico.

**Tempo:** ate 24 rodadas principais, 60 s de aquecimento + 90 s de medicao cada: 60 minutos de carga, mais partidas, coleta e analise. Reserve aproximadamente 1h30–2h; nao e um limite garantido. O teste isolado do gerador de 15/10 e omitido, com registro, se a imagem nao existir localmente: 21 rodadas principais, 52,5 minutos de carga. Mantenha a maquina na tomada, sem suspensao e sem outras tarefas pesadas. Nao execute outra coleta ao mesmo tempo. O script registra o plano de energia sem modifica-lo; prefira o mesmo Alto Desempenho das sessoes anteriores e mantenha-o constante.

Comandos opcionais, sem iniciar carga longa:

```bat
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Diagnose-WebFlux.ps1" -PlanOnly
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Diagnose-WebFlux.ps1" -CheckOnly
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Diagnose-WebFlux.ps1" -Smoke
```

## Hipoteses e condicoes

| Etapa | Rodadas | Mudanca em relacao ao WebFlux baseline a 1.000 req/s |
|---|---:|---|
| Baseline: MVC/RestTemplate, MVC/Feign e WebFlux | 9 | Nenhuma; tres repeticoes por variante, ordem sorteada por bloco |
| WebFlux a 500 req/s | 3 | Somente taxa de chegada |
| WebFlux com 1.000 VUs | 3 | Somente disponibilidade de usuarios do gerador; cota do gerador continua 2 CPUs/1 GiB |
| WebFlux com cota de 4 CPUs | 3 | Somente cota CPU; ActiveProcessorCount=2, heap e pools permanecem iguais |
| WebFlux com gerador de 15/10 | 3 opcionais | Somente imagem do k6; carga e scripts fixados |
| Perfil WebFlux e perfil MVC/RestTemplate | 2 | JFR profile ativado, uma rodada por variante; nao usar como repeticoes sem instrumentacao |
| WebFlux baseline final | 1 | Volta a configuracao inicial, para detectar possivel deriva durante a sessao |

O ensaio testa a cota de CPU, nao a escalabilidade com quatro threads/event loops. Mais VUs tambem aumentam o trabalho do gerador: melhora ou piora nesse braco precisa ser lida junto de sua utilizacao de recursos. As etapas nao sao randomizadas entre si; o baseline final e uma verificacao exploratoria, nao elimina efeitos de ordem. Se uma intervencao parecer promissora, confirmar depois com A/B intercalado antes de afirmar causalidade.

## Evidencias preservadas

- `results/diagnostico-.../index.html`: indice de todas as etapas; tambem acessivel por `DIAGNOSTICO.html` na raiz.
- `batches.json`: mapeia cada intervencao ao lote; `images.json`, configuracoes por etapa, `host.json` e `execucao.log` registram condicoes.
- Cada rodada mantem amostras brutas, qualidade, logs completos, Prometheus, estatisticas dos bancos e recursos de todos os containers (incluindo o gerador).
- `cgroup-before.txt` e `cgroup-after.txt`: quota, contadores de throttling, pressao de CPU e eventos de memoria, quando disponiveis no cgroup v2. Ausencia nao vira zero. Intervalo aproximado delimitado pelos comandos.
- Rodadas de perfil incluem `diagnostic.jfr`, copiado depois de parar a JVM normalmente e antes de recriar o container. Inclui inicializacao, aquecimento e medicao: selecionar o intervalo pelos timestamps dos logs. Arquivo limita-se a 128 MiB, portanto conferir cobertura temporal ao analisar.
- Nenhum resultado antigo e apagado. O artigo e seu suplemento nao sao atualizados automaticamente com estes dados.

JFR e configurado via `-XX:StartFlightRecording`, sem substituir a imagem JRE por JDK. O smoke verifica se a imagem aceita a flag e produz um arquivo com cabecalho JFR. O perfil tem custo proprio, por isso fica em etapas separadas. Fonte: https://docs.oracle.com/en/java/javase/21/docs/specs/man/java.html e https://docs.oracle.com/en/java/javase/21/jfapi/flight-recorder-configurations.html (consultadas em 27/10/2026).

## O que procurar depois

1. A degradacao reaparece com o mesmo binario? E com o gerador antigo?
2. O delta de `nr_throttled`/`throttled_usec` e o perfil indicam falta de CPU ou trabalho excessivo? Que stacks dominam o intervalo medido?
3. Dobrar apenas VUs elimina descartes ou agrava filas? O gerador esta limitado por CPU/memoria?
4. A dependencia de estoque e os bancos apresentam espera relevante?
5. `IllegalReferenceCountException` reaparece? Preservar stack e versoes, correlacionar com a resposta 500. Uma unica excecao nao explica automaticamente a lentidao de todas as rodadas.

Falhas e descartes na carga principal sao evidencias e nao interrompem o lote por si so. Falhas de infraestrutura, analise invalida, imagens divergentes ou exportacao JFR ausente interrompem com os arquivos preservados. Um teste sem reproduzir a falha nao comprova sua correcao. Esta entrega prepara o diagnostico; ainda nao corrige nem declara resolvida a causa do Netty/saturacao.
