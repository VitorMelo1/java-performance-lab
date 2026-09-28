# Registro de validação — 28/09/2026

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

Essas verificações comprovam funcionamento da bancada, não superioridade de uma arquitetura. Os ensaios curtos ocorreram em máquina compartilhada com outros containers e não devem ser usados como resultados do artigo. Não foram executadas as rodadas científicas de longa duração.

A última alteração de exportação distingue VUs alocados de requisições simultâneas. O ensaio final confirmou o campo allocated_vus_max. Não se inferiu concorrência real diretamente desse campo.
