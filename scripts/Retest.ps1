[CmdletBinding()]
param(
    [ValidateRange(1,20)][int]$Repetitions = 3,
    [ValidateRange(1,3600)][int]$Seconds = 120,
    [ValidateRange(1,600)][int]$WarmupSeconds = 60,
    [ValidateRange(1,10000)][int]$MaxVus = 500,
    [switch]$Quick,
    [switch]$PlanOnly
)
$ErrorActionPreference = 'Stop'
$settings = @{Rates=@(500,1000); Repetitions=$Repetitions; Seconds=$Seconds; WarmupSeconds=$WarmupSeconds; MaxVus=$MaxVus; Quick=$Quick; PlanOnly=$PlanOnly}
if (!$Quick -and !$PlanOnly) {
    $minutes = [Math]::Ceiling(16 * $Repetitions * ($Seconds + $WarmupSeconds) / 60)
    Write-Host "Reteste controlado: controle do upstream e comparacao das aplicacoes a 500 e 1000 req/s."
    Write-Host "Tempo minimo de carga: $minutes minutos; inicializacao e coleta acrescentam tempo."
    Write-Host 'Mantenha a maquina livre de outras tarefas pesadas durante a coleta.'
}
& "$PSScriptRoot/Benchmark.ps1" -Scenario upstream @settings
& "$PSScriptRoot/Benchmark.ps1" -Scenario all @settings
if (!$PlanOnly) { Write-Host 'Os dois lotes foram preservados em results. Analise ambos; nao misture com o protocolo anterior.' }
