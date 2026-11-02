# Gráficos gerados por código e dados das execuções

O gerador é gerar-graficos.py, em Python com Matplotlib. Ele não usa geração de imagens por IA nem valores escolhidos manualmente. As linhas conectam a mediana dos três p95 por condição; os pontos menores mostram as repetições. Os eixos de carga usam os valores reais 200, 500 e 1.000 req/s. As ligações não representam medições intermediárias.

## De onde vêm os números

1. O k6 grava as observações em results/<lote>/<rodada>/samples.json.gz.
2. benchmarks/quality.mjs confere contagens e calcula percentis; os resultados ficam em result.json e results.csv de cada lote.
3. O suplemento preserva esses resultados em arquivos identificados por lote e rodada: new-data.json, article-data.json e os JSON históricos. São cópias dos resultados das execuções, não dados de exemplo.
4. gerar-graficos.py lê essas cópias e calcula as medianas; dados-das-figuras.csv registra a origem de cada ponto.
5. conferir-tabelas.py confronta os 355 pontos com esses resultados. Recalcular diretamente as amostras requer extrair os dois ZIPs juntos e executar node recalcular-brutos.mjs.

## Regenerar os sete gráficos

Com Python 3 e matplotlib instalados, execute no CMD, na raiz do projeto:

```bat
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Gerar-Figuras-Artigo.ps1"
```

Se faltar matplotlib, use `py -3 -m pip install matplotlib` no Python escolhido. O script aceita `-PythonExe` para indicar outro executável. Ele gera PNG e SVG em results/figuras-artigo-reproduzidas e confere os pontos; não executa benchmarks nem modifica o PDF final.

Os lotes do artigo são fixados de propósito. Uma coleta nova não deve substituir automaticamente outra com JVM, cenário ou configuração diferente. Sua inclusão exige revisar método, figuras e conclusões juntos.

Na revisão visual, SQL e pedidos de 30 e 31/10 usam linhas de medianas e pontos das repetições. A Figura 3 mostra um quadro por sessão: mediana em negrito e mínimo–máximo abaixo. As Figuras 4 e 5 usam barras de medianas, valores escritos e hastes de mínimo–máximo; não são intervalos de confiança. Mediana zero pode coexistir com máximo maior que zero. As barras começam em zero. O suplemento de pedidos de 30/10 usa escala logarítmica na latência, explicitamente indicada. Os 355 valores e todas as tabelas permaneceram iguais.
