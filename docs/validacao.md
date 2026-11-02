# Registro de validação

## Revisão de 28 e 29/09/2026

- Corrigido o aquecimento: 60 s na taxa do cenário; medição padrão de 120 s.
- Corrigida a captura de logs: os serviços ativos são informados explicitamente, com início UTC da rodada e sem corte arbitrário nas últimas 300 linhas. Conferida a presença de logs Java nas sete combinações da execução curta.
- Corrigida a contagem de containers externos: Docker rejeitava o filtro negativo antigo, cujo erro podia produzir um zero enganoso. Agora são comparados os IDs totais e os IDs com a etiqueta do laboratório, verificando os códigos de saída.
- Adicionados plano sem execução, filtro de variante para diagnóstico, exclusão entre coletas simultâneas e resumo de contagens/variação temporal.
- 5 verificações do plano passaram no Windows PowerShell 5.1.
- 16 testes do analisador passaram no Node 22.14.0 do container, incluindo corrupção de gzip, contagens inconsistentes, amostras insuficientes, deriva e picos. Um erro de validação ocultado como AbortError no Node 22 foi reproduzido e corrigido sem relaxar as asserções.
- Os 15 testes funcionais das APIs passaram novamente: 5 em cada variante.
- O novo Retest Quick terminou com 8 rodadas sem falhas nem descartes: lotes `20260928-234939-f4f5fb` e `20260928-235002-e91604`. A duração curta é classificada como insuficiente para triagem temporal. Esses lotes foram iniciados antes da correção final do contador de containers e não devem ser usados como evidência de isolamento.
- Diagnóstico mais longo: lote `20260928-235423-51bdac`, WebFlux HTTP a 500 req/s, uma repetição, aquecimento 60 s na taxa alvo e medição 120 s. A medição teve 60.000 respostas corretas, zero falhas e zero descartes, p95 de 103 ms, p99 de 107 ms e 499,6 respostas válidas/s. As três janelas tiveram p95 de 103 ms, sem alerta pela heurística. O aquecimento teve 361 descartes, mantidos no diretório separado. Esse diagnóstico isolado não substitui a comparação completa nem suas repetições.

O artigo descreve a coleta original e o diagnóstico separadamente. O comando `Retest.ps1` prepara a comparação completa de 48 rodadas; sua execução integral e a atualização comparativa das conclusões permanecem pendentes.

## Histórico da validação inicial em 28/09/2026

## Verificações executadas

- Maven verify nos dois projetos: 6 testes unitários, 0 falhas, 0 testes ignorados. Os testes de validação foram observados falhando antes da implementação.
- Build Docker dos dois Dockerfiles, incluindo Maven verify dentro das imagens.
- Contrato contra PostgreSQL e upstream reais: 5 testes em cada uma das 3 variantes, 15 aprovações. Cobertura: leitura, ausência, entrada inválida, escrita persistida, erros remotos, timeout e 40 chamadas concorrentes com conferência do JSON.
- Benchmark Quick no Windows PowerShell 5.1: 7 rodadas (3 HTTP, 2 leitura SQL, 2 escrita SQL), todas com código k6 0, sem respostas inválidas ou iterações descartadas.
- Conferência independente dos 7 CSV/JSON/GZip, percentis exportados, contagens, métricas JVM, recursos Docker e limites efetivos do gerador.
- Após ajustes finais no coletor: execução direta do upstream por 12 segundos, 20 requisições/s, validando registro de imagem/limites, amostras de recursos incluindo k6 e exportação de VUs alocados.
- Regressão do logging no Windows PowerShell 5.1: stderr preservado com exit 0 e exit 7, sem confundir progresso normal do Docker com falha.
- Revisão independente do código e dos controles do experimento. Correções: esperar saúde da infraestrutura; preservar código de saída no PowerShell 5.1; registrar container efetivo do k6. Padronizado erro remoto como 502 e timeout por fase.

## Decisões de implementação

- Aplicar RestTemplate e OpenFeign ao MVC; usar WebClient no WebFlux para preservar I/O não bloqueante. A comparação é entre pilhas completas, não entre sintaxes isoladas.
- Manter SQL e HTTP como cenários independentes. Não há acesso ao banco no endpoint HTTP.
- Desativar o limite de statement apenas nas sessões administrativas de restauração/ANALYZE. As conexões da aplicação continuam usando o limite de 2 segundos da role.
- Interromper apenas aplicações deste laboratório; outros containers permaneceram ativos durante a verificação.
- Guardar dados de desenvolvimento na pasta local results, fora do pacote de fontes. As medições definitivas serão executadas pelo autor em condições controladas.

## Alcance

Essas verificações iniciais comprovavam funcionamento da bancada, não superioridade de uma arquitetura. Os ensaios curtos ocorreram em máquina compartilhada e não devem ser usados como resultados do artigo. Naquele estágio, as rodadas de longa duração ainda não haviam sido executadas; posteriormente o autor produziu o lote exploratório `20260928-171209-bc17aa`, com 84 rodadas.

A última alteração de exportação distingue VUs alocados de requisições simultâneas. O ensaio final confirmou o campo allocated_vus_max. Não se inferiu concorrência real diretamente desse campo.
