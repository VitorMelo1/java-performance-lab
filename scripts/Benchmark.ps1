[CmdletBinding()]
param(
    [ValidateSet('http','db-read','db-write','upstream','orders','inventory','nightly','knee','complement','all')][string]$Scenario = 'http',
    [ValidateRange(1,100000)][int[]]$Rates = @(50,200,500,1000),
    [ValidateRange(1,20)][int]$Repetitions = 3,
    [ValidateRange(1,3600)][int]$Seconds = 120,
    [ValidateRange(1,600)][int]$WarmupSeconds = 60,
    [ValidateRange(0,1000)][int]$DelayMs = 100,
    [ValidateRange(1,10000)][int]$MaxVus = 500,
    [int]$Seed = 20260928,
    [string]$SessionId = '',
    [ValidateSet('all','mvc-resttemplate','mvc-feign','webflux','upstream','inventory')][string]$Variant = 'all',
    [ValidateRange(0,1440)][int]$BudgetMinutes = 0,
    [string]$DiagnosticConfigPath = '',
    [switch]$PlanOnly,
    [switch]$Quick
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Common.ps1"
. "$PSScriptRoot/DiagnosticSupport.ps1"
if ($Quick) { $Rates=@(20); $Repetitions=1; $Seconds=5; $WarmupSeconds=3; $MaxVus=20 }
# 'knee' varre a faixa entre a carga ociosa e a saturada. Nos lotes de outubro 500 req/s
# ficou ocioso (p95 de 6 ms, zero descartes) e 1000 req/s ja havia colapsado (p95 de 790 a
# 1350 ms, 10% a 30% de descartes): a transicao, onde a diferenca entre as arquiteturas
# aparece, nao foi medida em nenhum ponto.
$scenarios = if ($Scenario -eq 'all') { @('http','db-read','db-write') } elseif ($Scenario -eq 'nightly') { @('db-read','db-write','orders','inventory') } elseif ($Scenario -eq 'knee') { @('db-write','orders') } elseif ($Scenario -eq 'complement') { @('db-read','db-write','orders') } else { @($Scenario) }
$matrix = @()
foreach ($kind in $scenarios) {
    $arms = if ($kind -in @('http','orders')) { $Variants } elseif ($kind -in @('upstream','inventory')) { @($kind) } else { @('mvc-resttemplate','webflux') }
    if ($Variant -ne 'all') { $arms = @($arms | Where-Object { $_ -eq $Variant }) }
    foreach ($rate in $Rates) {
        if ($Scenario -eq 'complement' -and (($kind -ne 'orders' -and $rate -ne 1000) -or ($kind -eq 'orders' -and $rate -notin @(500,1000)))) { continue }
        for ($rep=1; $rep -le $Repetitions; $rep++) {
            foreach ($arm in $arms) { $matrix += [pscustomobject]@{variant=$arm; scenario=$kind; rate=$rate; warmup_rate=$rate; repetition=$rep} }
        }
    }
}
if ($matrix.Count -eq 0) { throw 'A variante selecionada nao pertence ao cenario.' }
$random = New-Object System.Random($Seed)
for ($i=$matrix.Count-1; $i -gt 0; $i--) {
    $j=$random.Next($i+1); $tmp=$matrix[$i]; $matrix[$i]=$matrix[$j]; $matrix[$j]=$tmp
}
# Randomize within repetition blocks so an incomplete night keeps complete early blocks.
# Sort-Object nao e estavel no Windows PowerShell 5.1 (-Stable so existe no 6.2+), logo
# ordenar apenas por repetition descartava a ordem sorteada e a semente nao reproduzia a
# sequencia. shuffle_index preserva o sorteio como criterio de desempate explicito.
for ($i=0; $i -lt $matrix.Count; $i++) { $matrix[$i] | Add-Member NoteProperty shuffle_index $i }
$matrix = @($matrix | Sort-Object repetition, shuffle_index)
if ($PlanOnly) {
    [ordered]@{protocol=$ProtocolVersion; session=$SessionId; seconds=$Seconds; warmup_seconds=$WarmupSeconds; max_vus=$MaxVus; runs=@($matrix)} | ConvertTo-Json -Depth 6
    return
}
$batch = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,6)
$batchDir = Join-Path $LabRoot "results/$batch"
New-Item -ItemType Directory -Path $batchDir -Force | Out-Null
$lock = $null
try { $lock = [IO.File]::Open((Join-Path $LabRoot 'results/benchmark.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
catch { throw 'Ja existe uma coleta usando este laboratorio. Aguarde sua conclusao.' }
$rows = @()
$outcomes = @()
$batchClock = [Diagnostics.Stopwatch]::StartNew()
$finished = $false
$needsInventory = @($matrix | Where-Object { $_.scenario -in @('orders','inventory') }).Count -gt 0
$job = $null
Push-Location $LabRoot
try {
    & docker info --format '{{json .}}' | Set-Content -Encoding utf8 "$batchDir/docker-info.json"
    if ($LASTEXITCODE -ne 0) { throw 'Abra o Docker Desktop antes de iniciar.' }
    if ((Get-OtherContainerCount) -gt 0) { throw 'Ha containers de outros projetos ativos. Pare-os antes da coleta para reduzir interferencia.' }
    $diagnostic=$null
    if($DiagnosticConfigPath) {
        $diagnostic=Get-Content -LiteralPath $DiagnosticConfigPath -Raw | ConvertFrom-Json
        $resolved=(Invoke-Compose -Arguments @('--profile','*','config','--format','json') | Out-String) | ConvertFrom-Json
        Assert-DiagnosticConfig -Config $resolved -Images $diagnostic.images -Stage $diagnostic.stage
        foreach($entry in $diagnostic.images.PSObject.Properties) {
            $actual=(& docker image inspect --format '{{.Id}}' $entry.Value | Out-String).Trim()
            if($LASTEXITCODE -ne 0 -or $actual -ne $entry.Value){throw "Imagem congelada indisponivel: $($entry.Name)"}
        }
        Copy-Item -LiteralPath $DiagnosticConfigPath -Destination "$batchDir/diagnostic.json"
    } else {
        Invoke-Compose -Arguments @('build','k6')
    }
    $generatorVersion = (Invoke-Compose -Arguments @('run','--rm','--no-deps','-T','k6','version') | Out-String).Trim()
    if ($generatorVersion -notmatch '^k6 v1\.0\.0-labclock1\s') { throw "Gerador sem correcao do relogio: $generatorVersion" }
    $generatorVersion | Set-Content -Encoding utf8 "$batchDir/k6-version.txt"
    & docker version --format '{{json .}}' | Set-Content -Encoding utf8 "$batchDir/docker-version.json"
    Invoke-Compose -Arguments @('config') | Set-Content -Encoding utf8 "$batchDir/compose-resolved.yaml"
    $matrix | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 "$batchDir/order.json"
    # O plano de energia fica registrado: em carga baixa o laboratorio media ~1 ms a mais
    # por requisicao, inclusive no braco de controle e no tempo de bloqueio do gerador.
    # Sem plano de alto desempenho esse piso varia com a taxa e confunde a leitura.
    $powerPlan = 'indisponivel'
    try { $powerPlan = ((& powercfg /getactivescheme) -join ' ').Trim() } catch { $powerPlan = 'indisponivel' }
    [ordered]@{protocolVersion=$ProtocolVersion; warmupRatePolicy='ramp-to-target'; startedUtc=[DateTime]::UtcNow.ToString('o'); quick=[bool]$Quick; seconds=$Seconds;
        warmupSeconds=$WarmupSeconds; delayMs=$DelayMs; maxVus=$MaxVus; seed=$Seed;
        timingRevision='monotonic-anchor-v1'; k6Version=$generatorVersion;
        latencyBasis='raw_samples_filtered'; negativeSamplePolicy='point_exclusion_within_declared_budget';
        collectorPhases='warmup+measurement'; samplesExport='container_tmp_then_copy';
        session=$SessionId; diagnostic=[bool]$DiagnosticConfigPath;
        diagnosticStage=$(if($diagnostic){$diagnostic.stage.name}else{''});
        os=[Environment]::OSVersion.ToString(); processors=[Environment]::ProcessorCount;
        powerPlan=$powerPlan;
        otherContainers=(Get-OtherContainerCount)
    } | ConvertTo-Json | Set-Content -Encoding utf8 "$batchDir/metadata.json"
    $sourceFiles = Get-ChildItem mvc-jdbc/src,webflux-r2dbc/src,stock-service/src,infra,benchmarks,scripts -Recurse -File
    $sourceFiles += Get-Item compose.yaml,pom.xml,mvc-jdbc/pom.xml,webflux-r2dbc/pom.xml,mvc-jdbc/Dockerfile,webflux-r2dbc/Dockerfile,stock-service/pom.xml,stock-service/Dockerfile
    $sourceFiles | ForEach-Object {
        [pscustomobject]@{path=$_.FullName.Substring($LabRoot.Length+1); sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}
    } | Export-Csv -NoTypeInformation -Encoding utf8 "$batchDir/source-hashes.csv"
    Invoke-Compose -Arguments @('up','-d','--wait','--wait-timeout','90','postgres','upstream')
    Stop-LabApps
    Initialize-Orders
    if($needsInventory) { Start-Inventory }
    $index=0
    foreach ($cell in $matrix) {
        if($BudgetMinutes -gt 0 -and ($batchClock.Elapsed.TotalSeconds + $WarmupSeconds + $Seconds + 300) -gt ($BudgetMinutes * 60)) {
            Write-Warning 'Orcamento de tempo atingido. Rodadas pendentes ficam registradas em status.json.'
            break
        }
        $index++
        $runName = '{0:D3}-{1}-{2}-r{3}-rep{4}' -f $index,$cell.variant,$cell.scenario,$cell.rate,$cell.repetition
        $runDir = Join-Path $batchDir $runName
        New-Item -ItemType Directory -Path "$runDir/warmup" -Force | Out-Null
        $containerOut="/results/$batch/$runName"
        Write-Host "[$index/$($matrix.Count)] $runName"
        $runStartedUtc = [DateTime]::UtcNow.ToString('o')
        Stop-LabApps
        if ($cell.scenario.StartsWith('db-')) { Reset-LabDatabase }
        if ($cell.scenario -eq 'orders') { Reset-Orders; Reset-Inventory }
        if ($cell.variant -notin @('upstream','inventory')) { Start-LabApp $cell.variant }
        $baseUrl = if ($cell.variant -eq 'upstream') { 'http://upstream:9090' } elseif ($cell.variant -eq 'inventory') { 'http://stock-service:8080' } else { "http://$($cell.variant):8080" }
        $envArgs = @('-e',"BASE_URL=$baseUrl",'-e',"SCENARIO=$($cell.scenario)",'-e',"VARIANT=$($cell.variant)",
            '-e',"DELAY_MS=$DelayMs",'-e',"MAX_VUS=$MaxVus",'-e',"REPETITION=$($cell.repetition)")
        $warmRate = $cell.warmup_rate
        $stopFile = Join-Path $runDir 'collector.stop'
        $healthBase = if ($cell.variant -eq 'upstream') { '' } elseif ($cell.variant -eq 'inventory') { 'http://127.0.0.1:18084' } else { "http://127.0.0.1:$($Ports[$cell.variant])" }
        $metricNames = Get-JvmMetricNames -Variant $cell.variant
        Write-Host "Aquecimento: $WarmupSeconds s em degrau ate $warmRate req/s. Medicao: $Seconds s a $($cell.rate) req/s."
        # O coletor roda nas duas fases para que o custo de observacao seja o mesmo.
        $job = Start-ResourceCollector -OutputDir "$runDir/warmup" -StopFile "$stopFile.warmup" -HealthBase $healthBase -Metrics $metricNames
        try {
            $warmArguments = @('compose','run','--rm','-T') + $envArgs + @('-e',"RATE=$warmRate",'-e',"SECONDS=$WarmupSeconds",'-e','WARMUP=1','-e',"OUT_DIR=$containerOut/warmup",'k6','run','/scripts/load.js')
            $warmExit = Invoke-DockerLogged -Arguments $warmArguments -LogPath "$runDir/warmup/console.log"
        } finally {
            Stop-ResourceCollector -Job $job -StopFile "$stopFile.warmup" -LogPath "$runDir/warmup/collector.log"
            $job=$null
        }
        if ($warmExit -ne 0 -and $warmExit -ne 99) { throw "Falha no aquecimento: $runDir/warmup/console.log" }
        if (!(Test-Path "$runDir/warmup/row.json")) { throw "k6 nao gerou resumo do aquecimento: $runDir/warmup/console.log" }
        $warmRow = Get-Content "$runDir/warmup/row.json" -Raw | ConvertFrom-Json
        $warmErrors = $warmRow.requests - $warmRow.successful_requests
        # O ensaio curto usa aquecimento de 3 s e nao tem degrau nem plato (so a partir de
        # 30 s), logo a mensagem nao pode mandar olhar um plato que nunca sera impresso.
        if ($warmRow.dropped_iterations -gt 0 -or $warmErrors -gt 0) {
            $hint = if ($warmRow.plateau_expected_requests -gt 0) {
                'Perdas durante a subida sao esperadas; o que importa e a linha do plato abaixo.'
            } else {
                'Aquecimento curto, sem degrau nem plato: estes numeros sao descritivos e ficam separados da medicao no relatorio.'
            }
            Write-Warning ("Aquecimento com falhas ou descartes: {0} respostas invalidas; {1} iteracoes descartadas de {2} previstas. {3}" -f $warmErrors,$warmRow.dropped_iterations,$warmRow.expected_requests,$hint)
        }
        # O plato final do aquecimento e o indicador util: distingue "a aplicacao comecou
        # fria" de "a aplicacao nao sustenta esta taxa". Sem ele, descarte no aquecimento
        # era ambiguo e a medicao podia comecar fria sem aviso.
        $plateau = $warmRow.plateau_delivered_fraction
        if ($null -ne $plateau) {
            if ($plateau -lt 0.99) {
                Write-Warning ("Plato do aquecimento entregou {0:P1} da taxa alvo ({1} de {2} requisicoes), p95 {3:N1} ms. A bancada nao entregou o alvo de {4} req/s neste indicador. Investigue aplicacao e gerador: isto nao prova isoladamente um limite de capacidade. O contador legado inclui conclusoes apos a janela; confira a auditoria." -f $plateau,$warmRow.plateau_requests,$warmRow.plateau_expected_requests,$warmRow.plateau_p95_ms,$cell.rate)
            } else {
                Write-Host ("Indicador legado do plato atingiu o alvo (p95 {0:N2} ms). Isto nao comprova sozinho estabilizacao ou aquecimento completo." -f $warmRow.plateau_p95_ms)
            }
        }
        Write-Host 'Aquecimento executado. Iniciando medicao e coleta de recursos.'
        # A massa volta ao estado inicial depois do aquecimento, nao apenas antes dele.
        # No protocolo 3 so orders era restaurado aqui; db-write entrava na medicao com a
        # tabela carregada de tuplas mortas pelas escritas do aquecimento, em volume
        # proporcional a taxa, e o autovacuum podia disparar dentro da janela medida.
        if($cell.scenario -eq 'orders') { Reset-Orders }
        if($cell.scenario -eq 'db-write') { Reset-LabDatabase }
        # Scrape que delimita o inicio da janela medida.
        if($diagnostic){Save-DiagnosticCgroup -Variant $cell.variant -Path "$runDir/cgroup-before.txt"}
        $scraped = Save-PrometheusScrape -HealthBase $healthBase -Path "$runDir/prometheus-before.txt"
        Save-DatabaseStats -Path "$runDir/database-before.json"
        if($needsInventory) { Save-DatabaseStats -Path "$runDir/inventory-before.json" -Inventory }
        $ids = @(& docker compose ps -q)
        & docker inspect @ids | Set-Content -Encoding utf8 "$runDir/containers.json"
        $job = Start-ResourceCollector -OutputDir $runDir -StopFile $stopFile -HealthBase $healthBase -Metrics $metricNames
        try {
            $generatorName = "lab-k6-$batch-$index"
            # As amostras vao para o sistema de arquivos do container e sao copiadas depois.
            # No protocolo 3 o k6 gravava mais de um milhao de linhas JSON comprimidas
            # direto no bind mount do Windows durante a medicao, custo de I/O que a fase de
            # aquecimento nao pagava e que crescia com a taxa.
            $measureArguments = @('compose','run','--name',$generatorName,'-T') + $envArgs + @('-e',"RATE=$($cell.rate)",'-e',"SECONDS=$Seconds",'-e',"OUT_DIR=$containerOut",'k6','run','--out','json=/tmp/samples.json.gz','/scripts/load.js')
            $code = Invoke-DockerLogged -Arguments $measureArguments -LogPath "$runDir/console.log"
            & docker inspect $generatorName | Set-Content -Encoding utf8 "$runDir/generator.json"
            if ($LASTEXITCODE -ne 0) { throw 'Falha ao registrar o container do gerador.' }
        } finally {
            Stop-ResourceCollector -Job $job -StopFile $stopFile -LogPath "$runDir/collector.log"
            $job=$null
        }
        # Scrape que fecha a janela medida, antes de parar a aplicacao.
        if($diagnostic){Save-DiagnosticCgroup -Variant $cell.variant -Path "$runDir/cgroup-after.txt"}
        $scrapedAfter = Save-PrometheusScrape -HealthBase $healthBase -Path "$runDir/prometheus-after.txt"
        & docker cp "${generatorName}:/tmp/samples.json.gz" "$runDir/samples.json.gz"
        if ($LASTEXITCODE -ne 0) { throw "Falha ao copiar as amostras brutas do gerador. Confira $runDir/console.log." }
        & docker inspect @ids | Set-Content -Encoding utf8 "$runDir/containers-after.json"
        if($LASTEXITCODE -ne 0){throw 'Falha ao inspecionar os servicos apos a medicao.'}
        Assert-LabServices -Before @(Get-Content "$runDir/containers.json" -Raw | ConvertFrom-Json) -After @(Get-Content "$runDir/containers-after.json" -Raw | ConvertFrom-Json)
        & docker rm $generatorName | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao remover o container encerrado do gerador.' }
        Save-DatabaseStats -Path "$runDir/database-after.json"
        if($needsInventory) { Save-DatabaseStats -Path "$runDir/inventory-after.json" -Inventory }
        $logServices = @('postgres','upstream')
        if($needsInventory) { $logServices += @('stock-service','stock-db') }
        if ($cell.variant -notin @('upstream','inventory')) { $logServices += $cell.variant }
        Invoke-Compose -Arguments (@('logs','--no-color','--since',$runStartedUtc) + $logServices) | Set-Content -Encoding utf8 "$runDir/services.log"
        if (!(Test-Path "$runDir/row.json")) { throw "k6 nao gerou resumo. Confira $runDir/console.log (exit $code)." }
        $row = Get-Content "$runDir/row.json" -Raw | ConvertFrom-Json
        $row | Add-Member NoteProperty k6_exit_code $code
        $row | Add-Member NoteProperty warmup_exit_code $warmExit
        $row | Add-Member NoteProperty load_delivered ($row.dropped_iterations -eq 0)
        $row | Add-Member NoteProperty run $runName
        $row | Add-Member NoteProperty warmup_delivered (($warmRow.dropped_iterations -eq 0) -and ($warmErrors -eq 0))
        $row | Add-Member NoteProperty warmup_delivered_fraction $warmRow.delivered_fraction
        $row | Add-Member NoteProperty warmup_plateau_delivered_fraction $warmRow.plateau_delivered_fraction
        $row | Add-Member NoteProperty warmup_plateau_p95_ms $warmRow.plateau_p95_ms
        $row | Add-Member NoteProperty warmup_shape $warmRow.load_shape
        # Acima do joelho a latencia nao e comparavel entre bracos; fica marcado na rodada.
        $row | Add-Member NoteProperty above_knee ($null -ne $warmRow.plateau_delivered_fraction -and $warmRow.plateau_delivered_fraction -lt 0.99)
        $resourceSamples = @()
        if (Test-Path "$runDir/resources.jsonl") {
            $resourceSamples = @(Get-Content "$runDir/resources.jsonl" | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.stats.Count -gt 0 })
        }
        $row | Add-Member NoteProperty resources_collected ($resourceSamples.Count -gt 0)
        $analysisCode = Invoke-DockerLogged -Arguments @('compose','run','--rm','--no-deps','-T','checker','node','/benchmarks/analyze-run.mjs',$containerOut) -LogPath "$runDir/analysis.log"
        $row | Add-Member NoteProperty analysis_status 'ok'
        $row | Add-Member NoteProperty excluded_samples 0
        $row | Add-Member NoteProperty latency_basis 'k6_summary'
        if($analysisCode -eq 0) {
            $quality = Get-Content -LiteralPath "$runDir/quality.json" -Raw | ConvertFrom-Json
            $row.load_delivered = $quality.load_delivered
            $row | Add-Member NoteProperty stability_status $quality.stability.status
            $row | Add-Member NoteProperty error_count $quality.error_count
            # Os percentis do relatorio passam a vir das amostras brutas analisadas, pela
            # mesma formula em toda rodada. Sem isso, uma rodada com ponto retirado
            # continuaria publicando o resumo do k6, que inclui a amostra impossivel.
            $row | Add-Member NoteProperty k6_latency_p50_ms $row.latency_p50_ms
            $row | Add-Member NoteProperty k6_latency_p95_ms $row.latency_p95_ms
            $row | Add-Member NoteProperty k6_latency_p99_ms $row.latency_p99_ms
            $row.latency_p50_ms = $quality.latency.p50_ms
            $row.latency_p95_ms = $quality.latency.p95_ms
            $row.latency_p99_ms = $quality.latency.p99_ms
            $row.latency_mean_ms = $quality.latency.mean_ms
            $row.latency_basis = $quality.latency_basis
            $row.excluded_samples = $quality.excluded_samples.count
            if ($quality.excluded_samples.count -gt 0) {
                Write-Warning ("{0} duracoes impossiveis retiradas ponto a ponto, confirmadas em http_req_duration; a rodada foi preservada e os percentis recalculados. Registrar a exclusao no artigo." -f $quality.excluded_samples.count)
            }
        } else {
            $row.analysis_status = 'invalid'
            $row.load_delivered = $false
            $row | Add-Member NoteProperty stability_status 'analise_falhou'
            $row | Add-Member NoteProperty error_count ($row.requests - $row.successful_requests)
            $row | Add-Member NoteProperty k6_latency_p50_ms $row.latency_p50_ms
            $row | Add-Member NoteProperty k6_latency_p95_ms $row.latency_p95_ms
            $row | Add-Member NoteProperty k6_latency_p99_ms $row.latency_p99_ms
            Write-Warning "Analise invalida: $runDir/analysis.log. Evidencias preservadas; rodada excluida das agregacoes."
        }
        $row | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 "$runDir/result.json"
        $outcomes += [pscustomobject]@{run=$runName; cell=$cell; analysis=$row.analysis_status; k6Exit=$code}
        [ordered]@{protocol=$ProtocolVersion; state='running'; planned=$matrix.Count; completed=$outcomes.Count; outcomes=$outcomes; pending=@($matrix | Select-Object -Skip $outcomes.Count)} | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 "$batchDir/status.json"
        $rows += $row
        $previousCulture = [Threading.Thread]::CurrentThread.CurrentCulture
        try {
            [Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::InvariantCulture
            $rows | Export-Csv -NoTypeInformation -Encoding utf8 "$batchDir/results.csv"
        } finally { [Threading.Thread]::CurrentThread.CurrentCulture = $previousCulture }
        if ($code -ne 0 -and $code -ne 99) { throw "k6 falhou com codigo $code. Arquivos preservados em $runDir." }
        Write-Host ("Resultado: {0} respostas corretas; {1} falhas; {2} requisicoes nao iniciadas. Variacao temporal: {3}." -f $row.successful_requests,$row.error_count,$row.dropped_iterations,$row.stability_status)
        if ($code -eq 99) { Write-Warning 'Criterio nao atendido. Veja os numeros acima e quality.txt; a rodada foi preservada.' }
        if ($row.stability_status -eq 'variacao_detectada') { Write-Warning 'O tempo de resposta ou a vazao variaram entre janelas. Nao interpretar esta rodada como desempenho estabilizado.' }
        Stop-LabApps
        if($diagnostic -and $diagnostic.stage.profile){Save-DiagnosticProfile -Variant $cell.variant -Directory $runDir}
    }
    $finished = $outcomes.Count -eq $matrix.Count
    Write-Host "Coleta encerrada: $batchDir"
    $attention = @($rows | Where-Object { !$_.load_delivered -or $_.error_count -gt 0 -or $_.stability_status -ne 'sem_alerta' -or $_.excluded_samples -gt 0 }).Count
    Write-Host "$($rows.Count) rodadas concluidas; $attention exigem leitura das ressalvas. Sem alerta nao significa validacao cientifica automatica."
    $notDelivered = @($rows | Where-Object { !$_.load_delivered }).Count
    if ($notDelivered -gt 0) { Write-Warning "$notDelivered rodadas nao receberam a carga oferecida integralmente. Nessas condicoes compare vazao alcancada e CPU por requisicao; o p95 nao e comparavel entre bracos." }
    if ($Quick) { Write-Warning 'Ensaio curto: serve para verificar a bancada; nao e resultado cientifico.' }
} catch {
    $_ | Out-String | Set-Content -Encoding utf8 "$batchDir/fatal-error.log"
    throw
} finally {
    $state = if($finished){'complete'}elseif(Test-Path "$batchDir/fatal-error.log"){'failed'}else{'budget_exhausted'}
    [ordered]@{protocol=$ProtocolVersion; state=$state; planned=$matrix.Count; completed=$outcomes.Count; elapsed_minutes=$batchClock.Elapsed.TotalMinutes; outcomes=$outcomes; pending=@($matrix | Select-Object -Skip $outcomes.Count)} | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 "$batchDir/status.json"
    if ($null -ne $job) { Stop-Job $job; Remove-Job $job }
    try { Stop-LabApps } finally { Pop-Location; if ($null -ne $lock) { $lock.Dispose() } }
}

if($rows.Count -gt 0){
    Push-Location $LabRoot
    try{
        Invoke-Compose -Arguments @('run','--rm','--no-deps','-T','checker','node','/benchmarks/report.mjs',"/results/$batch")
        Write-Host "Graficos e tabelas: $batchDir/report/index.html"
    }finally{Pop-Location}
}



