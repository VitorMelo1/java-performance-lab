[CmdletBinding()]
param(
    [ValidateRange(1,20)][int]$Repetitions = 2,
    [ValidateRange(1,3600)][int]$Seconds = 90,
    [ValidateRange(1,600)][int]$WarmupSeconds = 60,
    [ValidateRange(1,10000)][int]$MaxVus = 500,
    [int[]]$Rates = @(500,600,700,800,900,1000),
    [ValidateRange(0,1440)][int]$BudgetMinutes = 240,
    [switch]$Quick,
    [switch]$PlanOnly
)
$ErrorActionPreference = 'Stop'
if (!$Quick -and !$PlanOnly) {
    $cells = 5
    $minutes = [Math]::Ceiling($cells * $Rates.Count * $Repetitions * ($Seconds + $WarmupSeconds) / 60)
    Write-Host 'Varredura do joelho: escrita SQL (duas implementacoes) e pedidos (tres clientes).'
    Write-Host 'A matriz noturna mede 200, 500 e 1000 req/s. Nos lotes de outubro 500 estava ocioso e'
    Write-Host '1000 ja havia colapsado, sem nenhum ponto entre os dois. Esta varredura preenche a faixa.'
    Write-Host "Tempo minimo de carga: $minutes minutos; inicializacao, reset e analise acrescentam tempo."
    Write-Host 'Nao suspenda o computador. Nao rode outra coleta ao mesmo tempo.'
    Write-Host 'Leia a vazao alcancada e a CPU por requisicao, nao apenas o p95: onde houver descartes,'
    Write-Host 'o p95 deixa de ser comparavel entre os bracos porque a carga entregue difere.'
}
& "$PSScriptRoot/Benchmark.ps1" -Scenario knee -Rates $Rates -Repetitions $Repetitions -Seconds $Seconds `
    -WarmupSeconds $WarmupSeconds -MaxVus $MaxVus -BudgetMinutes $BudgetMinutes -Quick:$Quick -PlanOnly:$PlanOnly
