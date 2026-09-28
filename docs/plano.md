# Plano de implementação — comparação Java
Objetivo: dois projetos executáveis e uma bancada que exporta medições reais.
Decisão: MVC/JDBC tem RestTemplate ou OpenFeign; WebFlux/R2DBC usa WebClient. O teste HTTP não acessa PostgreSQL e o teste SQL não chama outra API.
Versões de referência fixadas: Java 21, Spring Boot 4.0.3, Spring Cloud 2025.1.1. São versões para reproduzir esta bancada, não uma indicação de versão mais recente.
1. Definir e testar validação e contrato JSON iguais nas duas aplicações.
2. Implementar SQL explícito, leitura e escrita idempotente; pool de 20 conexões.
3. Implementar clientes HTTP, pool de 100 conexões, sem repetição automática.
4. Executar PostgreSQL e API auxiliar controlada no Docker, aplicações separadas.
5. Testar o mesmo contrato nas três variantes, incluindo falhas e concorrência.
6. Executar ensaio curto k6 e validar exportações; não tratar o ensaio como resultado do artigo.
7. Documentar execução, controles, limitações, métricas e empacotar fontes.

Critérios: resposta de sucesso e SQL equivalentes; 404 para registro ausente; 400 para entrada inválida; falha ou timeout remoto convertido em 502; arquivo bruto preservado em falhas; taxas oferecida e atingida distintas; nenhum resultado inventado.

