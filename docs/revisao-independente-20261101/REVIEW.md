# Independent scientific review — 2026-11-01

This was a read-only review. No manuscript, source code or measurement data were modified; no benchmark/build was run and no unpublished material was uploaded. Evidence paths below are relative to the project root. Review evidence is in this directory.

## Verdict

The results support an exploratory case study of particular implementations and sessions. No numerical contradiction was found in the headline results, all plotted values, or the bounded raw-data sample. That does not establish general framework superiority or explain the cross-day changes causally.

**Preprint:** close, but repair the reproducibility package and reporting issues below before presenting the deposit as a reproducible testbed. **Journal:** major revision is advisable, particularly contribution/related-work positioning and experimental reliability; alternatively, frame the work explicitly as an exploratory case study. No journal acceptance prediction is warranted.

## Independent evidence

[independent-checks.json](independent-checks.json) reconciles 302 archived run records with the historical/new summary fields. Excluding 20 short runs yields 282 main runs, 16,017,093 requests and two invalid responses. The main 31-October session has 72 runs, 3,672,060 validated responses and zero drops. SQL differences and order median p95 values agree with the manuscript: at 1,000 orders/s, 6.332531 ms RestTemplate, 6.171153 ms Feign and 10.413874 ms WebFlux.

[raw-sample-checks.json](raw-sample-checks.json) documents eight independently decompressed streams: five 31-October SQL/order runs, degraded 20-October WebFlux, 29-October WebFlux with four CPUs, and slow 1-November Feign. Their 714,276 HTTP observations reproduce p50/p95/p99 and request/success/drop counts. Selected archive/local gzip hashes match. This is **not** a full 302-stream raw audit.

[figure-and-resource-checks.json](figure-and-resource-checks.json) independently checks all 355 plotted values and all ten displayed CPU-throttling ratios against archived records/counters. PDF pages 1 and 8–12 were visually inspected; the five main figures are legible and correctly distinguish medians, individual points and min–max ranges.

## Prioritized confirmed findings

**1. High — deposited execution package is incomplete.** `docs/entrega-artigo/manuscrito.md:23` claims a reproducible testbed, while `LEIA-ME-publicacao.md:5` proposes depositing the PDF and two ZIPs. `Material-suplementar.zip` omits `scripts/Benchmark.ps1`, `scripts/Common.ps1`, `scripts/DiagnosticSupport.ps1`, SQL initialization/reset files, and `infra/k6-clock/Dockerfile` plus its regression test. `docs/publicacao/links.json:2–3` contains empty links. Readers can reanalyse data but cannot execute the advertised testbed from the deposit. Add a complete dated source snapshot or immutable archived source release and exact commands. These files exist locally; packaging repair does not require new measurements.

**2. Medium — current build recipe differs from the main runtime.** `mvc-jdbc/Dockerfile:1–7` matches the 1-November recipe. Preserved `20261031-032121-95a2b8/008-mvc-feign-orders-r1000-rep1/prometheus-before.txt` records JVM 21.0.13+9; `20261101-014109-c2d17d/001-mvc-feign-orders-r1000-rep1/prometheus-before.txt` records 21.0.12.1+1. Source/runtime evidence is in `independent-checks.json`. Provide separate dated reconstruction maps; do not imply that current fixed digests reproduce 31 October. The manuscript already acknowledges historical image limitations (`:81,151,167`). Exact reconstruction remains unverified.

**3. Medium — checker output overstates its work.** `docs/entrega-artigo/conferir-tabelas.py:26–27` checks a prior validation report's completion flag/count, then prints that 175 raw series were verified. It does not reread raw streams. Change the output to distinguish prior validation records from a fresh raw audit and direct readers to `recalcular-brutos.mjs`.

**4. Medium — “high concurrency” is not operationalized.** The title (`manuscrito.md:1`) conflates offered rates/allocated VUs with achieved concurrency. `benchmarks/load.js:49–53` controls arrivals and a VU ceiling. For 31 October at 1,000 req/s, throughput × mean HTTP duration gives approximately 0.59–0.99 active reads and 3.67–5.75 active order requests. These are **Little's-law-style approximations**, conditional on steady-state/accounting assumptions, not measured peaks, total queues or connections. Suggested title: **“An exploratory performance comparison of Spring MVC/JDBC and Spring WebFlux/R2DBC under container CPU quotas.”**

**5. Medium — clarify lifecycle boundaries.** `scripts/Benchmark.ps1:110–113,142,178–194` and `scripts/Common.ps1:49–56,79–82` show persistent dependencies and separate warm-up/measurement clients. All 72 main-session records show one stock-service container/start time. Suggested methods wording: “Only the evaluated API was recreated per run. Stock-service and databases remained running; data resets did not reset their JVM/cache state. Warm-up and measurement used separate k6 invocations, so client connections were not preserved.” This qualifies assumptions about repeated-run independence.

## Scientific limitations and improvements

The manuscript adequately discloses n=3, shared-host interference, dropped-load latency bias, sequential CPU interventions, JVM/transport changes and the absence of universal superiority claims (`manuscrito.md:117–157`). Do not replace these with request-level significance tests. A journal contribution needs clearer comparison with prior empirical work (`:21–37`), and stronger comparative claims need independent sessions of a frozen configuration. Figure 5 would be clearer with individual points because median-zero drops can coexist with nonzero maxima.

I did not audit every raw stream/hash, rerun tests/builds, independently verify warm-up trajectories or every response/persisted write, or isolate the causes of historical failures. Matching native/custom latency samples checks internal consistency, not independent timing calibration. No complete literature review or journal-format assessment was performed.
