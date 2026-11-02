[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateSet('A','B')][string]$Session,
    [switch]$PlanOnly,
    [switch]$CheckOnly
)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$baseline=Join-Path $root 'results/20261015-011234-1ceec5'
$repetitions=if($Session -eq 'A'){3}else{2}
$seed=if($Session -eq 'A'){20261020}else{20261021}
$arguments=@{Scenario='complement';Rates=@(500,1000);Repetitions=$repetitions;Seconds=90;WarmupSeconds=60;MaxVus=500;DelayMs=100;Seed=$seed;SessionId="complement-$Session";BudgetMinutes=240}
if($PlanOnly){ & "$PSScriptRoot/Benchmark.ps1" @arguments -PlanOnly; return }

# Conferir a configuracao original sem recompilar as aplicacoes nem executar cargas.
Push-Location $root
try {
    & docker info --format '{{.ServerVersion}}'
    if($LASTEXITCODE -ne 0){throw 'Abra o Docker Desktop e aguarde Engine running.'}
    foreach($entry in (Import-Csv -LiteralPath (Join-Path $baseline 'source-hashes.csv'))){
        # Somente selecao/identificacao de sessao e apresentacao foram alteradas.
        if($entry.path -in @('scripts\Benchmark.ps1','benchmarks\report.mjs')){continue}
        $path=Join-Path $root $entry.path
        if(!(Test-Path -LiteralPath $path) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $entry.sha256){
            throw "Arquivo diferente do lote de referencia: $($entry.path). Conferir antes de combinar os resultados."
        }
    }
    $expected=@{}
    foreach($folder in (Get-ChildItem -LiteralPath $baseline -Directory|Where-Object Name -Match '^\d{3}-')){
        foreach($file in 'containers.json','generator.json'){
            $captured=Get-Content -LiteralPath (Join-Path $folder.FullName $file) -Raw|ConvertFrom-Json
            foreach($container in $captured){
                $tag=$container.Config.Image
                if($expected.ContainsKey($tag) -and $expected[$tag] -ne $container.Image){throw "Imagem variou dentro do lote original: $tag"}
                $expected[$tag]=$container.Image
            }
        }
    }
    foreach($tag in $expected.Keys){
        $imageId=(& docker image inspect --format '{{.Id}}' $tag | Out-String).Trim()
        if($LASTEXITCODE -ne 0 -or $imageId -ne $expected[$tag]){throw "Imagem ausente ou diferente da coleta anterior: $tag. Nao reconstruir sem revisar a comparabilidade."}
    }
    $power=(& powercfg /getactivescheme | Out-String).Trim()
    if($power -notmatch '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'){throw 'Selecione Alto Desempenho, como no lote anterior, antes de continuar.'}
    . "$PSScriptRoot/Common.ps1"
    if((Get-OtherContainerCount) -gt 0){throw 'Pare os containers de outros projetos antes de coletar.'}
    Write-Host "Pre-verificacao concluida: sessao $Session; $($repetitions*10) rodadas; imagens e configuracao conferidas."
    if($CheckOnly){return}
    Write-Host 'Mantenha o computador na tomada, sem suspensao e sem outras tarefas pesadas.'
    Write-Host 'A metrica principal continua p95 por rodada. Falhas, descartes e alertas serao preservados.'
    $log=Join-Path $root ("results/complement-{0}-{1}.log" -f $Session,(Get-Date -Format 'yyyyMMdd-HHmmss'))
    Start-Transcript -LiteralPath $log | Out-Null
    try { & "$PSScriptRoot/Benchmark.ps1" @arguments } finally { Stop-Transcript | Out-Null }
} finally { Pop-Location }
