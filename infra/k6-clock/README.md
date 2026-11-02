# Gerador k6 com correção local do relógio

Imagem: `java-performance-lab-k6:1.0.0-labclock1`. Fonte oficial k6 1.0.0, commit `41b4984b7594a8828bfa724ae32b49c15c76b13d`, compilada com Go 1.24.2. Esta é uma modificação local, não uma versão oficial da Grafana.

## Falha e correção

Na coleta de 5 out. 2026, os cinco valores negativos de `http_req_duration` estavam associados a `http_req_receiving` negativo, todos com status HTTP 200. O tracer original salva instantes como `UnixNano` e reconstrói esses instantes com `time.Unix`; isso perde a informação monotônica de `time.Time`. Um ajuste regressivo do relógio civil durante a leitura do corpo pode tornar a subtração negativa. Não foi identificado qual componente do host provocou o ajuste nessa coleta.

`monotonic-clock.patch` ancora o relógio uma vez, na inicialização do processo, e gera os instantes usados pelo tracer com `origem.Add(time.Since(origem))`. `time.Since` usa a componente monotônica no Linux. Tanto os eventos HTTP quanto `Done()` usam a mesma base. A duração mantém o significado de envio + espera + recebimento; nenhuma amostra é zerada, descartada ou substituída. O timestamp exportado das métricas HTTP fica ancorado no horário de início do processo e pode divergir do relógio civil depois de um ajuste; a correlação exata com logs deve considerar isso. Outras métricas do k6 e logs não foram alterados.

## Verificação reproduzível

O teste injeta, somente numa cópia destinada a testes, um relógio civil que avança ou recua uma hora entre o primeiro byte e o término do recebimento. Nenhum relógio do Windows, WSL ou container é alterado. No original, a duração fica próxima de uma hora positiva ou negativa; no corrigido, continua refletindo os poucos milissegundos realmente decorridos.

Na raiz do projeto:

```powershell
# Este alvo DEVE falhar com CLOCK_STEP_CORRUPTED_DURATION: reproduz o defeito original.
docker build --target regression-original --progress plain infra/k6-clock

# Este build exige sucesso no teste corrigido e nos testes HTTP do k6.
docker compose build k6
docker compose run --rm --no-deps -T k6 version
```

O resultado deve identificar `k6 v1.0.0-labclock1`. O binário final não contém a função de relógio falso nem o teste. O Dockerfile preserva a licença AGPL do k6 e inclui o patch na imagem; a fonte de base e a alteração estão identificadas para reprodução.

`Build.ps1` constrói o gerador; `Benchmark.ps1` também garante o build e confere a versão antes de coletar, inclusive quando chamado diretamente por `Retest.ps1` ou `Nightly.ps1`. Cada lote registra `k6-version.txt`, `timingRevision` e hashes da fonte. Novas linhas usam `timing_revision=monotonic-anchor-v1`; o relatório rejeita agregar revisões diferentes. A matriz, pools, timeouts e cargas continuam iguais. Negativos inesperados continuam sendo rejeitados pelo analisador, pois indicariam um problema novo.

Referências: [tracer original](https://github.com/grafana/k6/blob/41b4984b7594a8828bfa724ae32b49c15c76b13d/lib/netext/httpext/tracer.go), [relógios monotônicos em Go](https://pkg.go.dev/time#hdr-Monotonic_Clocks).
