# Pacote para depósito como preprint — 01/11/2026

Abra [PUBLICAR.html](../../PUBLICAR.html), na raiz do projeto, para copiar os campos e incluir a URL real do GitHub. O guia completo está em [COMO-PUBLICAR.md](../publicacao/COMO-PUBLICAR.md). Execute scripts/Vincular-Publicacao.ps1 para gravar os links no README e em CITATION.cff.

Envie juntos Artigo-Spring-MVC-WebFlux.pdf, Material-suplementar.zip e Dados-brutos.zip. O DOCX é a cópia editável. O artigo contém cinco figuras e quatro tabelas; a galeria acrescenta duas figuras suplementares.

O Zenodo pode fornecer página pública e DOI como comprovante do depósito. Isso não equivale a aceite de revista, revisão por pares ou certificado de evento. A aceitação desse comprovante pela disciplina depende do professor. Nenhum registro foi publicado durante a preparação deste pacote.

Tipo recomendado: Publication / Preprint. Título e autores abaixo. Licença recomendada para o artigo: CC BY 4.0, a confirmar pelos autores; esta preparação não concede automaticamente uma licença às fontes de terceiros. Afiliação e ORCID devem ser preenchidos apenas se confirmados. Publique somente após conferir arquivos e metadados. Depois de publicado, salve o DOI e a página como comprovante; não rotule uma impressão própria como certificado emitido pelo repositório.

Fonte: https://help.zenodo.org/docs/get-started/quickstart/

Título: Análise de desempenho entre programação reativa com Spring WebFlux/R2DBC e programação tradicional com Spring MVC/JDBC em APIs Java sob alta concorrência

Autores: Vitor Martins Melo; Athos Lial Passos; Jonatan Mariano da Silva.

Palavras-chave: Spring MVC; Spring WebFlux; JDBC; R2DBC; avaliação de desempenho.

Resumo: Este estudo compara APIs Java implementadas com Spring MVC/JDBC e Spring WebFlux/R2DBC em operações SQL e pedidos com comunicação entre serviços. A bancada utiliza containers com cotas de recursos, geração de carga aberta e validação das respostas. Foram preservadas 282 rodadas principais e 20 testes curtos, distinguindo versões, sessões e intervenções diagnósticas. A matriz completa revisada de 31 de outubro de 2026 contém 72 rodadas, taxas de 200, 500 e 1.000 requisições por segundo e três repetições por condição. Suas 3.672.060 requisições de medição foram corretas, sem iterações descartadas. Nas operações SQL, as medianas dos p95 do MVC foram de 0,387 a 0,945 ms inferiores às do WebFlux. Em pedidos a 1.000 req/s, os p95 medianos foram 6,333 ms com RestTemplate, 6,171 ms com OpenFeign e 10,414 ms com WebClient. Sessões anteriores apresentaram degradação reativa, associada a restrição de CPU no diagnóstico; uma intervenção de cota acompanhou melhora, sem isolar todas as causas. A auditoria também identificou diferenças no transporte Feign, falhas de inicialização de conversores e mudança da JVM entre reconstruções. Os resultados caracterizam as implementações e demonstram a importância de preservar proveniência, entrega de carga e variabilidade, sem estabelecer superioridade universal de um paradigma.
