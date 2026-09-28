param(
    [ValidateSet('http','db-read','db-write','upstream','all')][string]$Scenario = 'http',
    [ValidateRange(1,100000)][int[]]$Rates = @(50,200,500,1000),
    [ValidateRange(1,20)][int]$Repetitions = 3,
    [ValidateRange(1,3600)][int]$Seconds = 45,
    [ValidateRange(1,600)][int]$WarmupSeconds = 15,
    [ValidateRange(0,1000)][int]$DelayMs = 100,
    [ValidateRange(1,10000)][int]$MaxVus = 500,
    [int]$Seed = 20260928,
    [switch]$Quick
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Common.ps1"
if ($Quick) { $Rates=@(20); $Repetitions=1; $Seconds=5; $WarmupSeconds=3; $MaxVus=20 }
$batch = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,6)
$batchDir = Join-Path $LabRoot "results/$batch"
New-Item -ItemType Directory -Path $batchDir -Force | Out-Null
$scenarios = if ($Scenario -eq 'all') { @('http','db-read','db-write') } else { @($Scenario) }
$matrix = @()
foreach ($kind in $scenarios) {
    $arms = if ($kind -eq 'http') { $Variants } elseif ($kind -eq 'upstream') { @('upstream') } else { @('mvc-resttemplate','webflux') }
    foreach ($rate in $Rates) {
        for ($rep=1; $rep -le $Repetitions; $rep++) {
            foreach ($arm in $arms) { $matrix += [pscustomobject]@{variant=$arm; scenario=$kind; rate=$rate; repetition=$rep} }
        }
    }
}
$random = New-Object System.Random($Seed)
for ($i=$matrix.Count-1; $i -gt 0; $i--) {
    $j=$random.Next($i+1); $tmp=$matrix[$i]; $matrix[$i]=$matrix[$j]; $matrix[$j]=$tmp
}
$rows = @()
$job = $null
Push-Location $LabRoot
try {
    & docker info --format '{{json .}}' | Set-Content -Encoding utf8 "$batchDir/docker-info.json"
    if ($LASTEXITCODE -ne 0) { throw 'Abra o Docker Desktop antes de iniciar.' }
    & docker version --format '{{json .}}' | Set-Content -Encoding utf8 "$batchDir/docker-version.json"
    Invoke-Compose -Arguments @('config') | Set-Content -Encoding utf8 "$batchDir/compose-resolved.yaml"
    $matrix | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 "$batchDir/order.json"
    [ordered]@{startedUtc=[DateTime]::UtcNow.ToString('o'); quick=[bool]$Quick; seconds=$Seconds;
        warmupSeconds=$WarmupSeconds; delayMs=$DelayMs; maxVus=$MaxVus; seed=$Seed;
        os=[Environment]::OSVersion.ToString(); processors=[Environment]::ProcessorCount;
        otherContainers=(& docker ps --filter 'label!=com.docker.compose.project=java-performance-lab' -q | Measure-Object).Count
    } | ConvertTo-Json | Set-Content -Encoding utf8 "$batchDir/metadata.json"
    $sourceFiles = Get-ChildItem mvc-jdbc/src,webflux-r2dbc/src,infra,benchmarks,scripts -Recurse -File
    $sourceFiles += Get-Item compose.yaml,pom.xml,mvc-jdbc/pom.xml,webflux-r2dbc/pom.xml,mvc-jdbc/Dockerfile,webflux-r2dbc/Dockerfile
    $sourceFiles | ForEach-Object {
        [pscustomobject]@{path=$_.FullName.Substring($LabRoot.Length+1); sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}
    } | Export-Csv -NoTypeInformation -Encoding utf8 "$batchDir/source-hashes.csv"
    Invoke-Compose -Arguments @('up','-d','--wait','--wait-timeout','90','postgres','upstream')
    Stop-LabApps
    $index=0
    foreach ($cell in $matrix) {
        $index++
        $runName = '{0:D3}-{1}-{2}-r{3}-rep{4}' -f $index,$cell.variant,$cell.scenario,$cell.rate,$cell.repetition
        $runDir = Join-Path $batchDir $runName
        New-Item -ItemType Directory -Path "$runDir/warmup" -Force | Out-Null
        $containerOut="/results/$batch/$runName"
        Write-Host "[$index/$($matrix.Count)] $runName"
        Stop-LabApps
        if ($cell.scenario.StartsWith('db-')) { Reset-LabDatabase }
        if ($cell.variant -ne 'upstream') { Start-LabApp $cell.variant }
        $baseUrl = if ($cell.variant -eq 'upstream') { 'http://upstream:9090' } else { "http://$($cell.variant):8080" }
        $envArgs = @('-e',"BASE_URL=$baseUrl",'-e',"SCENARIO=$($cell.scenario)",'-e',"VARIANT=$($cell.variant)",
            '-e',"DELAY_MS=$DelayMs",'-e',"MAX_VUS=$MaxVus",'-e',"REPETITION=$($cell.repetition)")
        $warmRate = [Math]::Min($cell.rate,100)
        $warmArguments = @('compose','run','--rm','-T') + $envArgs + @('-e',"RATE=$warmRate",'-e',"SECONDS=$WarmupSeconds",'-e',"OUT_DIR=$containerOut/warmup",'k6','run','/scripts/load.js')
        $warmExit = Invoke-DockerLogged -Arguments $warmArguments -LogPath "$runDir/warmup/console.log"
        if ($warmExit -ne 0 -and $warmExit -ne 99) { throw "Falha no aquecimento: $runDir/warmup/console.log" }

        $ids = @(& docker compose ps -q)
        & docker inspect @ids | Set-Content -Encoding utf8 "$runDir/containers.json"
        $stopFile = Join-Path $runDir 'collector.stop'
        $healthBase = if ($cell.variant -eq 'upstream') { '' } else { "http://127.0.0.1:$($Ports[$cell.variant])" }
        $job = Start-Job -ArgumentList $LabRoot,$runDir,$stopFile,$healthBase -ScriptBlock {
            param($root,$output,$stop,$api)
            Set-Location $root
            while (!(Test-Path -LiteralPath $stop)) {
                $now = [DateTime]::UtcNow.ToString('o')
                $ids = @(& docker ps -q --filter 'label=com.docker.compose.project=java-performance-lab')
                if ($ids.Count -gt 0) {
                    $stats = @(& docker stats --no-stream --format '{{json .}}' @ids 2>> "$output/collector-errors.log")
                    $statsExit = $LASTEXITCODE
                    [ordered]@{timestamp=$now; exitCode=$statsExit; stats=$stats} | ConvertTo-Json -Compress -Depth 6 | Add-Content -Encoding utf8 "$output/resources.jsonl"
                }
                if ($api) {
                    $metrics = @{}
                    foreach ($name in @('jvm.memory.used','jvm.threads.live','process.cpu.usage','jvm.gc.pause')) {
                        try { $metrics[$name] = Invoke-RestMethod "$api/actuator/metrics/$name" -TimeoutSec 1 }
                        catch { $metrics[$name] = @{collectionError=$_.Exception.Message} }
                    }
                    [ordered]@{timestamp=[DateTime]::UtcNow.ToString('o'); metrics=$metrics} | ConvertTo-Json -Compress -Depth 12 | Add-Content -Encoding utf8 "$output/jvm.jsonl"
                }
                Start-Sleep -Seconds 3
            }
        }
        try {
            $generatorName = "lab-k6-$batch-$index"
            $measureArguments = @('compose','run','--name',$generatorName,'-T') + $envArgs + @('-e',"RATE=$($cell.rate)",'-e',"SECONDS=$Seconds",'-e',"OUT_DIR=$containerOut",'k6','run','--out',"json=$containerOut/samples.json.gz",'/scripts/load.js')
            $code = Invoke-DockerLogged -Arguments $measureArguments -LogPath "$runDir/console.log"
            & docker inspect $generatorName | Set-Content -Encoding utf8 "$runDir/generator.json"
            if ($LASTEXITCODE -ne 0) { throw 'Falha ao registrar o container do gerador.' }
        } finally {
            New-Item -ItemType File -Path $stopFile -Force | Out-Null
            Wait-Job $job -Timeout 20 | Out-Null
            if ($job.State -eq 'Running') { Stop-Job $job }
            Receive-Job $job *> "$runDir/collector.log"
            Remove-Job $job
            $job=$null
        }
        & docker rm $generatorName | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao remover o container encerrado do gerador.' }
        & docker compose logs --no-color --tail 300 | Set-Content -Encoding utf8 "$runDir/services.log"
        if (!(Test-Path "$runDir/row.json")) { throw "k6 nao gerou resumo. Confira $runDir/console.log (exit $code)." }
        $row = Get-Content "$runDir/row.json" -Raw | ConvertFrom-Json
        $row | Add-Member NoteProperty k6_exit_code $code
        $row | Add-Member NoteProperty warmup_exit_code $warmExit
        $row | Add-Member NoteProperty load_delivered ($row.dropped_iterations -eq 0)
        $row | Add-Member NoteProperty run $runName
        $resourceSamples = @()
        if (Test-Path "$runDir/resources.jsonl") {
            $resourceSamples = @(Get-Content "$runDir/resources.jsonl" | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.stats.Count -gt 0 })
        }
        $row | Add-Member NoteProperty resources_collected ($resourceSamples.Count -gt 0)
        $rows += $row
        $previousCulture = [Threading.Thread]::CurrentThread.CurrentCulture
        try {
            [Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::InvariantCulture
            $rows | Export-Csv -NoTypeInformation -Encoding utf8 "$batchDir/results.csv"
        } finally { [Threading.Thread]::CurrentThread.CurrentCulture = $previousCulture }
        if ($code -ne 0 -and $code -ne 99) { throw "k6 falhou com codigo $code. Arquivos preservados em $runDir." }
        if ($code -eq 99) { Write-Warning 'Limite de erros ou carga nao atendido; resultado preservado e sinalizado.' }
        Stop-LabApps
    }
    Write-Host "Coleta concluida: $batchDir"
    if ($Quick) { Write-Warning 'Ensaio curto: serve para verificar a bancada; nao e resultado cientifico.' }
} finally {
    if ($null -ne $job) { Stop-Job $job; Remove-Job $job }
    Stop-LabApps
    Pop-Location
}

