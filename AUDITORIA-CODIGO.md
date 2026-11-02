# Auditoria do codigo — 27/10/2026

## Resultado

Revisao de MVC/JDBC, WebFlux/R2DBC, estoque, carga k6, patch do relogio, infraestrutura Docker/SQL, scripts PowerShell, analise, relatorios e testes. A leitura e os testes abaixo nao garantem ausencia de todos os defeitos. Nenhuma carga de desempenho foi iniciada nesta auditoria.

Seis falhas foram reproduzidas e corrigidas. Nenhuma delas demonstrou ser a causa da degradacao do WebFlux em 20/10. A verificacao reforcada dos 102 resultados existentes manteve p50/p95/p99 e conferiu 5.952.149 requisicoes, das quais 5.952.148 corretas. Evidencia: `docs/auditoria-codigo-20261027/validacao-lotes.json`.

## Falhas confirmadas e corrigidas

| Prioridade | Local | Problema reproduzido | Correcao |
|---|---|---|---|
| P2 | benchmarks/quality.mjs | Uma rodada do protocolo 4 podia passar com quantidade incompleta de amostras nativas http_req_duration. | Contagem nativa deve coincidir com requests. |
| P2 | benchmarks/quality.mjs | successful_requests era aceito do resumo sem confronto com o contador bruto. Uma resposta incorreta podia desaparecer se o resumo estivesse inconsistente. | Confere quantidade de amostras e soma dos valores 0/1 do contador bruto. |
| P2 | benchmarks/report.mjs | Falta de dados do aquecimento virava soma zero de falhas/descartes. | Totais incompletos ficam null; indisponibilidade nao significa sucesso. |
| P2 | benchmarks/report.mjs | Se o contador de timeout do pool caia de 10 para 2, o relatorio publicava 2 timeouts da medicao. Tambem aceitava cumulativo sem amostra inicial. | Delta exige duas amostras consistentes. Cumulativo fica separado; delta invalido fica null. |
| P2 | benchmarks/report.mjs | Se o contador de GC caia, o valor novo era tratado como cumulativo utilizavel no grafico da rodada. | Marca contador reiniciado e deixa delta de pausas/contagem indisponivel. |
| P2 | scripts/Test.ps1 | Lista fixa deixava catalog.test.mjs e report-regression.test.mjs fora do comando principal, alem de nao descobrir suites novas. | Descobre todas as suites unitarias .test.mjs, separando os dois contratos HTTP; inclui planos complementar e diagnostico. |

Os testes novos falharam nos casos esperados antes das correcoes e passaram depois. Os arquivos result.json, row.json e samples.json.gz dos lotes anteriores nao foram editados.

## Problema confirmado no indicador do plato — tratamento conservador

`benchmarks/load.js` contabiliza o plato pelo instante de conclusao apos o fim da rampa, sem limite superior. Reproducao em `plateau-evidence.json`:

- Chamada iniciada aos 44 s e terminada aos 46 s entra no contador, embora tenha comecado na rampa.
- Chamada iniciada aos 59 s e terminada aos 65 s entra no mesmo contador, mesmo terminando depois dos 60 s programados.

Assim, `plateau_delivered_fraction` nao mede precisamente a fracao das chegadas agendadas no plato que foram executadas. Pode incluir trabalho acumulado e drenagem, dividindo-o apenas pelos 15 s planejados. `above_knee` e uma sinalizacao legada, nao prova isolada de capacidade maxima ou de que a aplicacao terminou aquecida. Os avisos de execucao foram tornados mais cautelosos.

**A carga historica permanece congelada para reproduzir o defeito.** Trocar sua definicao agora quebraria a comparacao controlada dos geradores de 15/10 e 20/10. Para uma proxima revisao do protocolo, registrar inicio e fim de cada iteracao e publicar separadamente chegadas iniciadas no plato, conclusoes dentro dele e drenagem; identificar a nova revisao e nao misturar suas metricas com as antigas. O defeito nao altera o calculo do p95 da medicao de 90 s, feito a partir de outras amostras.

## Investigacao que permanece aberta

1. **Netty e saturacao:** o log da primeira rodada WebFlux/orders/1000 de 20/10 registra HTTP 500 com IllegalReferenceCountException em netty-codec-base 4.2.10.Final. As outras duas rodadas lentas nao mostram essa mesma excecao. O caminho reativo revisado nao usa .block(), Thread.sleep ou liberacao manual de ByteBuf; isso nao descarta bugs indiretos de biblioteca, transporte ou configuracao. Nao se alterou versao do Netty por tentativa.
2. **Observabilidade dos erros externos:** RemoteErrors no MVC converte excecoes Feign/RestTemplate em 502 sem registrar a causa. Impede atribuir com precisao as falhas de aquecimento. Melhorar os logs em uma futura imagem de diagnostico e comparar separadamente; nao substituir a imagem congelada silenciosamente.
3. **Isolamento do laboratorio:** a trava do Benchmark impede duas coletas desse script ao mesmo tempo, mas Build.ps1/Test.ps1/Start.ps1 ainda podem interferir se executados manualmente em outro terminal. Nao executa-los junto do diagnostico. A afinidade opcional em compose.cpuset.yaml usa indices que exigem verificacao da topologia; no Docker/WSL nao prova fixacao em nucleos P/E do host. O diagnostico atual nao usa esse arquivo.

SQL parametrizado, validacao de quantidade/estoque, protecao contra overflow do total, insercao atomica com chave unica e mapeamento explicito foram inspecionados. Nao foi identificado nesses pontos um defeito concreto que explique o episodio. Isso nao equivale a validacao de um sistema comercial de pedidos: o fluxo registra pedidos, sem baixa distribuida de estoque ou pagamento, como o artigo ja descreve.

## Verificacao executada

- 62 testes Node locais: qualidade, relatorios, catalogo, carga simulada, sensibilidade e regressoes novas; todos passaram.
- Maven offline `mvn -o -B -q test`: seis testes Java de validacao passaram, tres por API. O servico de estoque nao tem testes Java proprios nessa suite.
- Planos e protecoes verificados no Windows PowerShell 5.1: Benchmark, Nightly, Complement, InfrastructureState, DiagnosticProtocol e cobertura do runner.
- Oito configuracoes do diagnostico validadas pelo Docker Compose sem iniciar daemon/containers.
- Reanalise somente de leitura dos 102 arquivos de amostras brutas; contagens nativas, sucessos e percentis conferidos. Nao e uma nova repeticao experimental.
- Contratos HTTP com Docker e reteste de desempenho **nao foram executados** nesta auditoria. Continuam sob execucao do usuario no terminal.

O comando para o reteste continua `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Diagnose-WebFlux.ps1`. As imagens e os cinco arquivos da carga historica continuam iguais ao manifesto. As correcoes de analise rodam depois da medicao, sem alterar o trabalho das APIs durante a coleta.

Nao publicar uma alegacao de causa resolvida antes de analisar o reteste. O manuscrito e o suplemento anteriores nao foram sobrescritos por esta auditoria.
