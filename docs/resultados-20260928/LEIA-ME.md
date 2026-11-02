# Análise dos resultados — 28/09/2026

Lote: `20260928-171209-bc17aa`. As 84 rodadas foram analisadas. Esta pasta contém os dados derivados e as figuras; os dados brutos permanecem em `results/20260928-171209-bc17aa` no projeto.

## O que os resultados mostram

- 1.574.991 chamadas iniciadas, 1.574.292 respostas válidas e 699 falhas.
- 78.818 iterações programadas não foram iniciadas em 20 rodadas. Essas iterações não têm tempo de resposta medido.
- As outras 64 rodadas não tiveram descartes nem falhas.
- Na leitura SQL a 1.000 req/s, o p95 mediano foi 10 ms para MVC e 618 ms para WebFlux. MVC entregou integralmente a carga; WebFlux teve descartes nas três repetições.
- Na escrita a 500 req/s, ambos entregaram a carga sem erros: p95 mediano de 21 ms no MVC e 237 ms no WebFlux.
- Nas chamadas HTTP a 500 req/s, OpenFeign e RestTemplate entregaram a carga sem erros. WebClient teve descartes em duas repetições e forte variação.
- WebFlux usou menos threads e memória nas comparações de recursos apresentadas, mas isso não se traduziu em menor latência.

## Como ler os gráficos

Os pontos representam a mediana de três medidas por rodada. As barras representam mínimo e máximo; não são intervalos de confiança. O eixo de latência é logarítmico e o eixo de carga usa os valores numéricos das taxas programadas. O símbolo × indica que pelo menos uma repetição teve descarte de iterações.

O p95 mediano de três rodadas não é o percentil de todas as requisições agrupadas. Vazão válida considera somente respostas corretas e usa a duração efetiva informada pelo k6, incluindo drenagem final.

## Limitações que precisam acompanhar a conclusão

O aquecimento foi de 15 segundos, limitado a 100 req/s; a medição durou 45 segundos. As séries temporais mostram variação forte dentro de algumas rodadas. Isso impede afirmar que todas as medidas representam um sistema estabilizado e não permite atribuir a diferença exclusivamente ao paradigma reativo ou bloqueante.

Os resultados são exploratórios e descrevem estas implementações, configurações e máquina. As rodadas com descartes não representam carga integralmente entregue. Para fortalecer a conclusão, o próximo passo é repetir as condições instáveis com aquecimento na taxa alvo e duração maior, verificar estabilidade e dimensionar o gerador com controle de seus recursos. Não é necessário excluir nem esconder a primeira coleta.

## Arquivos

- `db-read`, `db-write`, `http` em PNG/SVG: três comparações incorporadas ao artigo.
- `estabilidade-http.png`: variação temporal entre as três repetições de WebFlux HTTP a 500 req/s.
- `resumo-por-cenario.csv`: 28 condições, com mediana e amplitude das três repetições. Separador vírgula; números com ponto decimal.
- `dados-analisados.json`: medidas por rodada, agrupamentos e janelas temporais.
- `auditoria.json`: contagens, configuração do lote, imagens e conferência de hashes do código.
- `texto-artigo.md`: extração auxiliar dos parágrafos; o DOCX é a versão de entrega e contém também as tabelas e figuras.

Foi feita conferência das contagens e dos p95 contra as amostras brutas de todas as 84 rodadas. As imagens dos containers permaneceram constantes no lote; não houve divergência nos hashes dos arquivos de código registrados.

## Revisão do protocolo

O contador `otherContainers` do lote inicial não é confiável: o Docker rejeita o filtro negativo usado pelo script antigo. Os logs dessa coleta também não incluíram explicitamente os containers Java ativos. Ambos foram corrigidos nos scripts novos. A metodologia do artigo continua descrevendo a coleta que de fato produziu os números: 15 s de aquecimento limitado a 100 req/s e 45 s de medição. As novas durações não foram atribuídas retroativamente aos dados antigos.

## Verificação diagnóstica complementar

O lote `20260928-235423-51bdac` contém uma rodada isolada WebFlux HTTP a 500 req/s, com 60 s de aquecimento na taxa alvo e 120 s de medição. A medição completou 60.000 chamadas válidas, sem falhas nem descartes, com p95 de 103 ms e p99 de 107 ms. Os dados estão em `diagnostico-protocolo.json`. Não foram agregados às figuras nem às medianas da coleta original; uma repetição isolada não classifica as três alternativas.
