[CmdletBinding()]
param([switch]$PlanOnly,[switch]$CheckOnly,[switch]$Smoke)
$ErrorActionPreference='Stop'
. "$PSScriptRoot/Common.ps1"
. "$PSScriptRoot/DiagnosticSupport.ps1"
$stages=@(Get-DiagnosticStages)
if($PlanOnly){
    [ordered]@{purpose='diagnostic-not-publication';warmupSeconds=60;seconds=90;mainRuns=24;smokeRuns=4;stages=$stages} | ConvertTo-Json -Depth 8
    return
}
if(!(Get-Command docker -ErrorAction SilentlyContinue)){
    $dockerBin='C:\Program Files\Docker\Docker\resources\bin'
    if(Test-Path -LiteralPath "$dockerBin/docker.exe"){$env:PATH="$dockerBin;$env:PATH"}else{throw 'Docker nao encontrado. Instale/abra o Docker Desktop.'}
}
$savedCompose=$env:COMPOSE_FILE
$savedSeparator=$env:COMPOSE_PATH_SEPARATOR
$savedProject=$env:COMPOSE_PROJECT_NAME
$lock=$null; $transcript=$false; $destination=$null; $entries=@(); $success=$false
Push-Location $LabRoot
try {
    & docker info --format '{{.ServerVersion}}'
    if($LASTEXITCODE -ne 0){throw 'Abra o Docker Desktop, aguarde Engine running e execute o mesmo comando novamente.'}
    if((Get-OtherContainerCount) -gt 0){throw 'Ha containers de outros projetos ativos. Pare-os antes deste diagnostico.'}
    $manifest=Get-Content -LiteralPath "$PSScriptRoot/diagnostic-images.json" -Raw | ConvertFrom-Json
    foreach($entry in $manifest.workloads.PSObject.Properties){
        $path=Join-Path $LabRoot $entry.Name
        if(!(Test-Path -LiteralPath $path) -or (Get-FileHash -LiteralPath $path).Hash -ne $entry.Value){throw "Carga ou massa mudou desde 20/10: $($entry.Name). Revisar antes de comparar."}
    }
    foreach($entry in $manifest.images.PSObject.Properties){
        $id=(& docker image inspect --format '{{.Id}}' $entry.Value | Out-String).Trim()
        if($LASTEXITCODE -ne 0 -or $id -ne $entry.Value){throw "Imagem historica ausente: $($entry.Name) / $($entry.Value). Nao reconstruir para substituir silenciosamente. Envie esta mensagem para revisarmos o plano."}
    }
    # The day-15 generator is an optional diagnostic arm, never silently replaced.
    $oldPreference=$ErrorActionPreference
    try{$ErrorActionPreference='Continue';$oldId=(& docker image inspect --format '{{.Id}}' $manifest.generator15 2>$null | Out-String).Trim();$oldAvailable=$LASTEXITCODE -eq 0 -and $oldId -eq $manifest.generator15}
    finally{$ErrorActionPreference=$oldPreference}
    if(!$oldAvailable){Write-Warning 'Gerador de 15/10 nao esta no Docker local. Etapa comparativa sera registrada como indisponivel (3 rodadas a menos).'}
    if($CheckOnly){Write-Host 'Pre-verificacao OK. Nenhuma imagem recompilada; nenhuma carga executada.';return}
    New-Item -ItemType Directory -Force -Path "$LabRoot/results" | Out-Null
    try{$lock=[IO.File]::Open("$LabRoot/results/diagnostic.lock",'OpenOrCreate','ReadWrite','None')}catch{throw 'Ja existe um diagnostico em andamento.'}
    # Test the benchmark lock without holding it across child invocations.
    try{$probe=[IO.File]::Open("$LabRoot/results/benchmark.lock",'OpenOrCreate','ReadWrite','None');$probe.Dispose()}catch{throw 'Ja existe uma coleta em andamento.'}
    $session='diagnostico-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,6)
    $destination=Join-Path $LabRoot "results/$session"
    New-Item -ItemType Directory -Path $destination | Out-Null
    Start-Transcript -LiteralPath "$destination/execucao.log" | Out-Null; $transcript=$true
    Copy-Item -LiteralPath "$PSScriptRoot/diagnostic-images.json" -Destination "$destination/images.json"
    $stages | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 "$destination/plan.json"
    $hostEvidence=[ordered]@{capturedUtc=[DateTime]::UtcNow.ToString('o');powerPlan=((& powercfg /getactivescheme)|Out-String).Trim();generator15Available=$oldAvailable}
    try{$hostEvidence.cpu=@(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors);$hostEvidence.memory=Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory}catch{$hostEvidence.hostError=$_.Exception.Message}
    $hostEvidence | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 "$destination/host.json"
    $env:COMPOSE_PATH_SEPARATOR=';'
    $env:COMPOSE_PROJECT_NAME='java-performance-lab'
    $env:COMPOSE_FILE="$LabRoot/compose.yaml;$destination/override.json"

    function Invoke-DiagnosticStage {
        param($stage,[switch]$Quick)
        $images=($manifest.images | ConvertTo-Json | ConvertFrom-Json)
        if($stage.generator -eq '15'){$images.k6=$manifest.generator15}
        $override=New-DiagnosticOverride -Images $images -Stage $stage
        $override | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 "$destination/override.json"
        $config=(Invoke-Compose -Arguments @('--profile','*','config','--format','json') | Out-String) | ConvertFrom-Json
        Assert-DiagnosticConfig -Config $config -Images $images -Stage $stage
        $label=if($Quick){'smoke-'+$stage.name}else{$stage.name}
        $configPath="$destination/$label.json"
        @{stage=$stage;images=$images;quick=[bool]$Quick;session=$session} | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 $configPath
        $before=@(Get-ChildItem -LiteralPath "$LabRoot/results" -Directory | Select-Object -ExpandProperty Name)
        Write-Host "ETAPA $label : $($stage.variant), $($stage.rate) req/s, $($stage.vus) VUs, CPU $($stage.cpu), perfil=$($stage.profile)"
        & "$PSScriptRoot/Benchmark.ps1" -Scenario orders -Variant $stage.variant -Rates @($stage.rate) -Repetitions $stage.repetitions -Seconds 90 -WarmupSeconds 60 -MaxVus $stage.vus -Seed 20261027 -SessionId "$session/$label" -DiagnosticConfigPath $configPath -Quick:$Quick | Out-Host
        $created=@(Get-ChildItem -LiteralPath "$LabRoot/results" -Directory | Where-Object {$_.Name -notin $before -and $_.Name -match '^\d{8}-\d{6}-[a-f0-9]+$'})
        if($created.Count -ne 1){throw 'Nao foi possivel identificar inequivocamente o lote; arquivos preservados.'}
        $batch=$created[0]
        $status=Get-Content -LiteralPath "$($batch.FullName)/status.json" -Raw | ConvertFrom-Json
        if($status.state -ne 'complete'){throw "Etapa incompleta: $($batch.FullName)"}
        $rows=@(Import-Csv -LiteralPath "$($batch.FullName)/results.csv")
        if(@($rows | Where-Object {$_.analysis_status -ne 'ok'}).Count){throw "Analise de amostras invalida em $($batch.FullName). Diagnostico interrompido."}
        if($Quick -and @($rows | Where-Object {[int]$_.error_count -ne 0 -or [int]$_.dropped_iterations -ne 0 -or [int]$_.successful_requests -le 0}).Count){throw "Smoke com falhas: $($batch.FullName). Nao iniciar carga longa."}
        return [pscustomobject]@{stage=$label;batch=$batch.Name;runs=$rows.Count;profile=$stage.profile;cpu=$stage.cpu;vus=$stage.vus;generator=$stage.generator;quick=[bool]$Quick}
    }
    # Four short rounds validate all three APIs plus JFR export before a long session.
    $entries+=Invoke-DiagnosticStage -stage $stages[0] -Quick
    $entries | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 "$destination/batches.json"
    $entries+=Invoke-DiagnosticStage -stage $stages[5] -Quick
    $entries | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 "$destination/batches.json"
    if(!$Smoke){
        Write-Host 'Smoke aprovado. Carga principal: 60 minutos (52,5 sem gerador antigo), mais inicializacoes e analise. Reserve aproximadamente 1h30 a 2h.'
        foreach($stage in $stages){
            if($stage.generator -eq '15' -and !$oldAvailable){continue}
            $entries+=Invoke-DiagnosticStage -stage $stage
            $entries | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 "$destination/batches.json"
        }
    }
    $success=$true
} catch {
    if($destination){$_ | Out-String | Set-Content -Encoding utf8 "$destination/fatal-error.log"}
    throw
} finally {
    if($destination){
        @{state=$(if($success){'complete'}else{'failed'});finishedUtc=[DateTime]::UtcNow.ToString('o');stages=$entries} | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 "$destination/status.json"
        $links=@($entries | ForEach-Object {"<li>$($_.stage) ($($_.runs) rodadas): <a href='../$($_.batch)/report/index.html'>relatorio</a> | <a href='../$($_.batch)/'>arquivos e JFR</a></li>"}) -join "`n"
        "<!doctype html><meta charset='utf-8'><title>Diagnostico WebFlux</title><h1>Diagnostico WebFlux</h1><p>Estado: $(if($success){'concluido'}else{'interrompido'}). Condicoes distintas; nao agregar como uma unica amostra nem substituir o artigo automaticamente.</p><ul>$links</ul><p>Consulte batches.json, images.json, host.json e execucao.log. JFR inclui inicio, aquecimento e medicao; use timestamps dos logs para selecionar a fase.</p>" | Set-Content -Encoding utf8 "$destination/index.html"
        $relative=Split-Path $destination -Leaf
        "<!doctype html><meta charset='utf-8'><a href='results/$relative/index.html'>Abrir ultimo diagnostico WebFlux</a>" | Set-Content -Encoding utf8 "$LabRoot/DIAGNOSTICO.html"
        Write-Host "Arquivos do diagnostico: $destination"
    }
    $env:COMPOSE_FILE=$savedCompose; $env:COMPOSE_PATH_SEPARATOR=$savedSeparator; $env:COMPOSE_PROJECT_NAME=$savedProject
    if($lock){$lock.Dispose()}
    if($transcript){Stop-Transcript | Out-Null}
    Pop-Location
}

