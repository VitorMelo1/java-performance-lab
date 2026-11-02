# Conferência da revisão de 01/11/2026

- 175 novas séries de medição relidas: contagens nativas e de respostas corretas conferidas, p50/p95/p99 coincidentes com os resultados salvos; zero amostras excluídas.
- 127 séries históricas preservadas com relatórios das auditorias anteriores; não foram reapresentadas como se tivessem sido coletadas novamente.
- 302 séries no pacote de dados brutos, com SHA-256 conferido depois da gravação.
- 355 pontos das sete figuras confrontados com resultados de origem; tabelas SQL recalculadas.
- Quatro testes de contexto Feign executados nesta revisão, sem falhas. Não foram iniciados benchmarks nem reconstruídas imagens Docker.
- Modelo DOCX preservado em geometria e partes de referência; PDF renderizado pelo Microsoft Word e inspecionado visualmente.
- Conclusões discriminam JVM, transporte, plano de energia, correção de inicialização e perdas. A origem da exceção Netty histórica não é apresentada como resolvida.
- Arquivos preparados para depósito; não há DOI ou certificado presumido.

Revisão visual: linhas de medianas nos gráficos SQL/pedidos, eixos de carga proporcionais e legendas maiores. 355 valores preservados; PNGs reproduzidos; figuras embutidas no Word conferidas por hash. PDF mantém 16 páginas; somente páginas 8 e 9 mudaram e foram inspecionadas, demais páginas idênticas à revisão anterior.

Revisão de legibilidade de 01/11: Figura 3 em quadro numérico (mediana e mínimo–máximo); Figuras 4 e 5 em barras com valores escritos e hastes de mínimo–máximo; suplemento de pedidos de 30/10 com latência em escala logarítmica identificada. Os 355 valores foram comparados, incluindo multiplicidades, e permaneceram iguais. Sete PNGs regenerados com hashes idênticos; cinco imagens embutidas no Word conferidas. PDF com 16 páginas: páginas 1–9 idênticas à revisão anterior; páginas 10–16 renderizadas e inspecionadas, sem cortes. Fonte do manuscrito e tabelas preservadas. Suplemento verificado por CRC e manifestos SHA-256.
