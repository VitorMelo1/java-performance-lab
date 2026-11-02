$ErrorActionPreference = 'Stop'
$LabRoot = Split-Path $PSScriptRoot -Parent
# Fonte unica da versao do protocolo. Estava escrita a mao em cinco lugares, e ao subir de
# 3 para 4 o portao do Run-Overnight ficou exigindo 3: o ensaio curto passava 8/8 e a
# coleta era rejeitada. benchmarks/load.js tem a sua propria copia (outra linguagem) e
# tests/BenchmarkProtocol.ps1 verifica que as duas concordam.
$ProtocolVersion = 4
$Variants = @('mvc-resttemplate', 'mvc-feign', 'webflux')
$Ports = @{'mvc-resttemplate'=18081; 'mvc-feign'=18082; 'webflux'=18083; 'stock-service'=18084}

function Invoke-DockerLogged {
    param([string[]]$Arguments, [string]$LogPath)
    $previousPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5.1 transforma stderr nativo em ErrorRecord.
        # Docker usa stderr para progresso normal; quem decide falha e o exit code.
        $ErrorActionPreference = 'Continue'
        & docker @Arguments *> $LogPath
        $nativeExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    return $nativeExitCode
}

function Invoke-Compose {
    param([string[]]$Arguments)
    & docker compose @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose falhou ($LASTEXITCODE): $Arguments" }
}
function Get-OtherContainerCount {
    $running = @(& docker ps -q)
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel listar os containers ativos.' }
    $lab = @(& docker ps -q --filter 'label=com.docker.compose.project=java-performance-lab')
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel identificar os containers do laboratorio.' }
    return @($running | Where-Object { $_ -and $_ -notin $lab }).Count
}
function Wait-App {
    param([string]$Variant)
    $url = "http://127.0.0.1:$($Ports[$Variant])/actuator/health"
    for ($attempt=0; $attempt -lt 90; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri $url -TimeoutSec 2
            if ($health.status -eq 'UP') { return }
        } catch {}
        Start-Sleep -Seconds 1
    }
    & docker compose logs --tail 80 $Variant
    throw "Aplicacao $Variant nao ficou pronta."
}
function Stop-LabApps {
    Invoke-Compose -Arguments (@('stop') + $Variants)
}
function Start-LabApp {
    param([string]$Variant)
    Stop-LabApps
    Invoke-Compose -Arguments @('up','-d','--no-build','--force-recreate',$Variant)
    Wait-App $Variant
}
function Reset-LabDatabase {
    $sql = "SET statement_timeout = 0; TRUNCATE products RESTART IDENTITY; INSERT INTO products(name, price_cents, stock) SELECT 'Produto ' || i, 1000 + i, 100 FROM generate_series(1,10000) AS i;"
    $sql | & docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U lab -d lab
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao restaurar os dados do laboratorio.' }
    & docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U lab -d lab -c 'SET statement_timeout = 0' -c 'VACUUM ANALYZE products;'
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao analisar os dados do laboratorio.' }
}


function Initialize-Orders {
    Get-Content -LiteralPath "$LabRoot/infra/orders.sql" -Raw | & docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U lab -d lab
    if ($LASTEXITCODE -ne 0) { throw 'Falha na migracao local de pedidos.' }
}
function Reset-Orders {
    & docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U lab -d lab -c 'TRUNCATE orders;' -c 'VACUUM ANALYZE orders;'
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao limpar pedidos sinteticos.' }
}
function Reset-Inventory {
    Get-Content -LiteralPath "$LabRoot/infra/inventory.sql" -Raw | & docker compose exec -T stock-db psql -v ON_ERROR_STOP=1 -U inventory -d inventory
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao restaurar estoque sintetico.' }
}
function Start-Inventory {
    Invoke-Compose -Arguments @('up','-d','--no-build','stock-service')
    Wait-App 'stock-service'
}
function Save-DatabaseStats {
    param([string]$Path, [switch]$Inventory)
    $service = if($Inventory){'stock-db'}else{'postgres'}
    $database = if($Inventory){'inventory'}else{'lab'}
    $sql = "SELECT json_build_object('time',clock_timestamp(),'database',(SELECT row_to_json(d) FROM pg_stat_database d WHERE datname=current_database()),'tables',(SELECT json_agg(t) FROM pg_stat_user_tables t),'activity',(SELECT json_agg(a) FROM (SELECT state,wait_event_type,wait_event,count(*) FROM pg_stat_activity WHERE datname=current_database() GROUP BY state,wait_event_type,wait_event) a));"
    & docker compose exec -T $service psql -v ON_ERROR_STOP=1 -U $database -d $database -At -c $sql | Set-Content -Encoding utf8 $Path
    if($LASTEXITCODE -ne 0){throw "Falha ao coletar estatisticas de $service."}
}

# Metricas que existem em cada braco. No protocolo 3 o coletor pedia hikaricp.* e
# r2dbc.* em todos, de modo que metade das chamadas ao Actuator devolvia erro a cada
# amostra: trabalho jogado fora dentro da janela medida e ruido em jvm.jsonl.
# process.cpu.time e um contador acumulado de segundos de CPU da JVM. A CPU por requisicao
# vinha da mediana de 'docker stats' amostrada a cada 3-6 s; a diferenca deste contador
# entre o fim do aquecimento e o fim da medicao da o valor exato da janela medida.
$JvmMetricsCommon = @('jvm.memory.used','jvm.threads.live','process.cpu.usage','process.cpu.time','jvm.gc.pause')
# Contadores cumulativos sobrevivem a amostragem grossa; o gauge 'pending' nao. No lote de
# outubro hikaricp.connections.pending apareceu 0,0 em todas as amostras, e a historia do
# esgotamento de pool do Feign se apoiava apenas no log da aplicacao.
$JvmMetricsBlocking = @('hikaricp.connections.active','hikaricp.connections.pending','hikaricp.connections.idle',
    'hikaricp.connections.timeout','hikaricp.connections.acquire','hikaricp.connections.usage','hikaricp.connections.creation')
# O r2dbc-pool nao expoe contador de timeout de aquisicao equivalente ao do Hikari.
# Assimetria de instrumentacao a declarar nos resultados.
$JvmMetricsReactive = @('r2dbc.pool.acquired','r2dbc.pool.pending','r2dbc.pool.idle',
    'r2dbc.pool.allocated','r2dbc.pool.max.allocated','r2dbc.pool.max.pending')
function Get-JvmMetricNames {
    param([string]$Variant)
    if ($Variant -eq 'upstream') { return @() }
    if ($Variant -eq 'webflux') { return $JvmMetricsCommon + $JvmMetricsReactive }
    return $JvmMetricsCommon + $JvmMetricsBlocking
}

# Dois scrapes Prometheus delimitam a janela medida. Os baldes do histograma de
# http.server.requests sao contadores acumulados: a subtracao do scrape anterior pelo
# posterior da a distribuicao da medicao, medida DENTRO da aplicacao, sem o relogio nem o
# tempo de bloqueio do gerador. E a segunda fonte independente de latencia.
function Save-PrometheusScrape {
    param([string]$HealthBase,[string]$Path)
    if (!$HealthBase) { return $false }
    try {
        $response = Invoke-WebRequest -Uri "$HealthBase/actuator/prometheus" -TimeoutSec 5 -UseBasicParsing
        $response.Content | Set-Content -Encoding utf8 -LiteralPath $Path
        return $true
    } catch {
        "scrape indisponivel: $($_.Exception.Message)" | Set-Content -Encoding utf8 -LiteralPath "$Path.erro"
        return $false
    }
}

# O coletor passa a rodar tambem no aquecimento. No protocolo 3 ele rodava so na medicao,
# de modo que a janela medida pagava o custo de 'docker stats' e do Actuator e a janela
# de aquecimento nao: uma diferenca sistematica entre as duas fases.
function Start-ResourceCollector {
    param([string]$OutputDir,[string]$StopFile,[string]$HealthBase,[string[]]$Metrics)
    if (Test-Path -LiteralPath $StopFile) { Remove-Item -LiteralPath $StopFile -Force }
    return Start-Job -ArgumentList $LabRoot,$OutputDir,$StopFile,$HealthBase,$Metrics -ScriptBlock {
        param($root,$output,$stop,$api,$metricNames)
        Set-Location $root
        while (!(Test-Path -LiteralPath $stop)) {
            $now = [DateTime]::UtcNow.ToString('o')
            $ids = @(& docker ps -q --filter 'label=com.docker.compose.project=java-performance-lab')
            if ($ids.Count -gt 0) {
                $stats = @(& docker stats --no-stream --format '{{json .}}' @ids 2>> "$output/collector-errors.log")
                $statsExit = $LASTEXITCODE
                [ordered]@{timestamp=$now; exitCode=$statsExit; stats=$stats} | ConvertTo-Json -Compress -Depth 6 | Add-Content -Encoding utf8 "$output/resources.jsonl"
            }
            if ($api -and @($metricNames).Count -gt 0) {
                $metrics = @{}
                foreach ($name in $metricNames) {
                    try { $metrics[$name] = Invoke-RestMethod "$api/actuator/metrics/$name" -TimeoutSec 1 }
                    catch { $metrics[$name] = @{collectionError=$_.Exception.Message} }
                }
                [ordered]@{timestamp=[DateTime]::UtcNow.ToString('o'); metrics=$metrics} | ConvertTo-Json -Compress -Depth 12 | Add-Content -Encoding utf8 "$output/jvm.jsonl"
            }
            Start-Sleep -Seconds 3
        }
    }
}
function Stop-ResourceCollector {
    param($Job,[string]$StopFile,[string]$LogPath)
    if ($null -eq $Job) { return }
    New-Item -ItemType File -Path $StopFile -Force | Out-Null
    Wait-Job $Job -Timeout 20 | Out-Null
    if ($Job.State -eq 'Running') { Stop-Job $Job }
    Receive-Job $Job *> $LogPath
    Remove-Job $Job
}

function Assert-LabServices {
    param([object[]]$Before,[object[]]$After)
    # Windows PowerShell 5.1 may wrap a JSON array as a single pipeline object.
    $Before=@($Before | ForEach-Object { $_ })
    $After=@($After | ForEach-Object { $_ })
    foreach($previous in $Before){
        $current=@($After | Where-Object Id -eq $previous.Id)
        if($current.Count -ne 1 -or !$current[0].State.Running -or $current[0].State.OOMKilled -or $current[0].RestartCount -ne $previous.RestartCount){
            throw "Falha de infraestrutura em $($previous.Name). Consulte containers-after.json; nao interpretar como saturacao normal."
        }
    }
}
