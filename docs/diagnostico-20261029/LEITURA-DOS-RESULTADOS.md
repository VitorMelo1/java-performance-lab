# Diagnóstico de 29/10/2026 — conferência dos resultados

Sessão: `diagnostico-20261029-033938-6a3f79`. Concluída às 04:46 (Brasília), cerca de 67 minutos após o início. Nenhuma nova carga foi executada durante esta análise.

## Integridade

Foram concluídas 21 rodadas principais e quatro testes curtos. Releitura das amostras brutas das 25 rodadas confirmou contagens de requisições, durações nativas e respostas corretas; p50, p95 e p99 conferem com os resultados salvos (tolerância numérica de 1e-8 ms). Nenhuma duração foi excluída. Isso confirma a integridade numérica verificada, não certifica ausência de interferência ou estabilidade experimental.

Na medição principal: **1.732.079 requisições observadas**, **1.732.078 corretas**, **1 resposta inválida** e **22.939 iterações não iniciadas**. A soma reúne condições diferentes apenas para contabilização; não é uma estimativa conjunta de desempenho. Os quatro testes curtos tiveram 403 respostas corretas, zero erros na medição e zero descartes.

No aquecimento das rodadas principais houve 353 respostas inválidas e 60.032 descartes; nos testes curtos, quatro respostas inválidas no aquecimento. Não misturar esses valores com a medição.

## Resultados por condição

Todos os ensaios abaixo usam o cenário de pedidos (`orders`). O p95 é o tempo abaixo do qual ficaram 95% das respostas observadas em uma rodada. A tabela usa a mediana dos p95 das repetições, não o p95 de amostras agrupadas. Descartes são iterações que o gerador não iniciou, não respostas HTTP com erro.

| Etapa | Implementação | n | p95 mediano (ms) | Mín.–máx. dos p95 (ms) | Descartes somados | Respostas inválidas |
|---|---|---:|---:|---:|---:|---:|
| baseline | mvc-resttemplate | 3 | 19,43 | 10,35–24,1 | 0 | 0 |
| baseline | webflux | 3 | 627,82 | 429,93–737,1 | 12.927 | 0 |
| baseline | mvc-feign | 3 | 10,99 | 9,75–13,96 | 0 | 0 |
| webflux-500 | webflux | 3 | 6,18 | 5,89–7,4 | 0 | 0 |
| webflux-vus1000 | webflux | 3 | 1.158,11 | 1.082,82–1.204,97 | 6.673 | 1 |
| webflux-cpu4 | webflux | 3 | 13,87 | 13,63–14,17 | 0 | 0 |
| perfil-webflux | webflux | 1 | 585,29 | 585,29–585,29 | 2.774 | 0 |
| perfil-mvc | mvc-resttemplate | 1 | 13,96 | 13,96–13,96 | 0 | 0 |
| baseline-final | webflux | 1 | 487,33 | 487,33–487,33 | 565 | 0 |

Baseline: 1.000 req/s, cota de 2 CPUs, 500 VUs. `webflux-500` altera somente a taxa; `webflux-vus1000` altera somente o limite de VUs; `webflux-cpu4` altera somente a cota de CPU. Heap, pools e ActiveProcessorCount=2 permanecem constantes. Etapas de perfil usam JFR e têm custo adicional; não são repetições sem instrumentação.

## Evidência de restrição pela cota de CPU

Percentual de períodos do cgroup em que ocorreu throttling, calculado por Δnr_throttled / Δnr_periods. A janela entre as capturas envolve a medição e algum tempo de operação do script; não é precisamente a janela de 90 segundos. Isso não representa percentual do tempo de parede perdido.

| Etapa | Implementação | Períodos com throttling por rodada (%) |
|---|---|---|
| baseline | mvc-resttemplate | 2,59; 3,27; 2,18 |
| baseline | webflux | 65,91; 36,62; 51,2 |
| baseline | mvc-feign | 2,93; 1,74; 1,97 |
| webflux-500 | webflux | 1,85; 0,87; 0,43 |
| webflux-vus1000 | webflux | 51,74; 47,24; 43,87 |
| webflux-cpu4 | webflux | 0; 0; 0 |
| perfil-webflux | webflux | 50,05 |
| perfil-mvc | mvc-resttemplate | 5,93 |
| baseline-final | webflux | 40,02 |

A degradação voltou com cota de 2 CPUs; com 4 CPUs, as três repetições entregaram a carga sem descartes e sem erros de medição, com p95 entre 13,63 e 14,17 ms. A volta final a 2 CPUs apresentou p95 de 487,33 ms e 565 descartes. Em conjunto com o cgroup, isso sustenta a hipótese de sensibilidade à cota de CPU nessa implementação e bancada. Não prova que a cota explique toda diferença entre dias nem identifica qual operação interna provoca os picos. As etapas não foram intercaladas aleatoriamente; ordem, aquecimento do host e estado compartilhado continuam limitações.

Dobrar apenas VUs não eliminou descartes e aumentou o p95 observado. Isso não é uma solução demonstrada para a saturação. Os p95 sob cargas efetivamente entregues diferentes devem ser apresentados junto de vazão e descartes; não usar razões desses p95 como comparação justa de velocidade.

## Erros e perfis

- webflux-vus1000, 002-webflux-orders-r1000-rep2: Netty IllegalReferenceCountException=true; falha de aquisição R2DBC=true; erros na medição=1; erros no aquecimento=0.
- webflux-vus1000, 003-webflux-orders-r1000-rep3: Netty IllegalReferenceCountException=false; falha de aquisição R2DBC=true; erros na medição=0; erros no aquecimento=335.

A exceção Netty reapareceu no braço com 1.000 VUs. O baseline lento não apresentou essa exceção nos logs consultados: portanto ela não explica, sozinha, todas as rodadas lentas. Também há timeouts de aquisição R2DBC no aquecimento; a separação por fase impede contabilizá-los indevidamente como erros de medição. A causa interna da exceção permanece aberta.

Os três arquivos JFR (incluindo o teste curto) têm cabeçalho válido. O leitor do JDK abriu os dois perfis principais: WebFlux com 171 s e MVC com 174 s. Os arquivos abrangem início/aquecimento/medição; ainda não foi realizada atribuição por stack restrita à janela de medição.

## Limitações para o artigo

- Todas as etapas registraram o mesmo plano **Razer Cortex Power Plan**, diferente do Alto Desempenho dos lotes anteriores. Seu efeito não foi isolado; não atribuir a diferença entre dias apenas à aplicação ou ao gerador.
- O gerador histórico de 15/10 estava ausente. As três rodadas correspondentes foram omitidas, sem substituição.
- O cenário investigado é `orders`; estes resultados não respondem por todos os cenários SQL/HTTP.
- Resultados com variação temporal e descartes descrevem comportamento sob sobrecarga, não regime estável.
- JFR e aumento de CPU são intervenções separadas; não juntar todas as 21 rodadas numa média nem acrescentá-las indistintamente às 102 anteriores.
- O artigo, os gráficos finais e o suplemento de publicação ainda precisam incorporar este diagnóstico. Este relatório não atualiza automaticamente esses arquivos.

É possível incluir o diagnóstico como análise de sensibilidade exploratória, preservando a conclusão restrita às condições testadas. Uma afirmação causal mais forte exigiria comparação intercalada com ambiente controlado.

Evidências por rodada e contadores: [validacao.json](validacao.json). Script de releitura: [audit-diagnostic-20261029.mjs](audit-diagnostic-20261029.mjs).
