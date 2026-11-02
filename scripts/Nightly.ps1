[CmdletBinding()]
param([switch]$Quick,[switch]$PlanOnly)
$ErrorActionPreference='Stop'
if(!$PlanOnly){
    Write-Host 'Protocolo 4: pedidos/estoque, leitura SQL, escrita SQL e controle do estoque.'
    Write-Host '72 rodadas; 180 minutos de carga + inicializacao/coleta. Orcamento: 240 minutos.'
    Write-Host 'Aquecimento em degrau ate a taxa alvo; percentis recalculados das amostras brutas.'
    Write-Host 'Nao suspenda o computador. Evite outras tarefas pesadas. Nao rode outro teste ao mesmo tempo.'
    Write-Host 'Antes de coletar: plano de energia em Alto Desempenho e sincronizacao de tempo do'
    Write-Host 'convidado desativada. Veja docs/protocolo-v4.md. Depois, rode Knee.ps1 para a faixa 500-1000.'
}
& "$PSScriptRoot/Benchmark.ps1" -Scenario nightly -Rates 200,500,1000 -Repetitions 3 -Seconds 90 -WarmupSeconds 60 -BudgetMinutes 240 -Quick:$Quick -PlanOnly:$PlanOnly
