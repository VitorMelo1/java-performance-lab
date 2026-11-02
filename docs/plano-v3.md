# Execução — protocolo 3

Objetivo: preparar, testar e entregar a bancada de pedidos/estoque e coleta de até quatro horas solicitada pelo usuário. Execução neste projeto, preservando alterações existentes; sem commit/push automático.

Especificação: [protocolo-v3.md](protocolo-v3.md).

- [ ] Reproduzir falha do analisador e testar duração nativa, inclusive retrocesso do relógio; continuar rejeitando amostras corrompidas.
- [ ] Criar testes de contrato para pedido persistido, total calculado, duplicata, dados inválidos, indisponibilidade e concorrência; observar falhas antes de implementar.
- [ ] Implementar stock-service e seu PostgreSQL; consultas parametrizadas, PK e limites de entrada; teste direto de inventário.
- [ ] Implementar pedido equivalente em MVC e WebFlux com persistência local, validação e clientes HTTP existentes; sem block() em WebFlux.
- [ ] Configurar Compose, inicialização e reset das tabelas; construir imagens com testes Java.
- [ ] Estender Benchmark com cenários orders/inventory, logs próprios do analisador, status persistente, limite de tempo e medições PostgreSQL/JVM. Testar plano e falhas de análise.
- [ ] Criar Nightly.ps1: 72 rodadas, taxas 200/500/1000, 3 repetições, 60/90 s; ordem por bloco, prazo 240 min e relatório dos itens pendentes.
- [ ] Validar contratos nas três variantes, smoke da matriz e uma rodada orders com medição suficiente para o analisador.
- [ ] Arquivar resultados antigos e de validação, conferir hashes e limpar apenas pastas de lotes; entregar comando CMD e guia.

Revisão: falha remota não grava pedido; duplicata não sobrescreve dados; lote parcial não aparece como completo; k6 com erros/descartes mantém evidência; dados de protocolos diferentes não são agregados.

Evidência inicial: Docker sem containers ativos. Falha reproduzida em 20260930-180142-e289bb/008-webflux-db-read-r500-rep2: request_wall_ms = -1 na linha 323545. Há 60.001 respostas corretas no resumo, mas duração bruta inválida impede validar a rodada pelo protocolo antigo.
