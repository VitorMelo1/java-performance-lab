$ErrorActionPreference='Stop'
$plan = & "$PSScriptRoot/../scripts/Benchmark.ps1" -Scenario nightly -Rates 200,500,1000 -Repetitions 3 -Seconds 90 -WarmupSeconds 60 -PlanOnly | ConvertFrom-Json
if($plan.runs.Count -ne 72){throw 'A matriz deve conter 72 rodadas.'}
foreach($rep in 1..3){
    $block=@($plan.runs | Where-Object repetition -eq $rep)
    if($block.Count -ne 24){throw 'Bloco incompleto.'}
    foreach($rate in 200,500,1000){
        $cell=@($block | Where-Object rate -eq $rate)
        if($cell.Count -ne 8){throw 'Carga sem todas as comparacoes.'}
        if(@($cell | Where-Object scenario -eq 'orders').Count -ne 3){throw 'Faltam clientes de pedidos.'}
        if(@($cell | Where-Object scenario -eq 'inventory').Count -ne 1){throw 'Falta controle do estoque.'}
    }
}
$last=0
foreach($r in $plan.runs){if($r.repetition -lt $last){throw 'Blocos fora de ordem.'};$last=$r.repetition}
if($plan.protocol -ne 4){throw 'Protocolo sem versao nova.'}
# A ordem sorteada precisa sobreviver a ordenacao por bloco: Sort-Object nao e estavel no
# Windows PowerShell 5.1, logo o desempate explicito por shuffle_index e o que torna a
# sequencia reproduzivel a partir da semente.
if(@($plan.runs | Where-Object { $null -eq $_.shuffle_index }).Count){throw 'Plano sem indice de sorteio reproduzivel.'}
$repeated = & "$PSScriptRoot/../scripts/Benchmark.ps1" -Scenario nightly -Rates 200,500,1000 -Repetitions 3 -Seconds 90 -WarmupSeconds 60 -PlanOnly | ConvertFrom-Json
for($i=0;$i -lt $plan.runs.Count;$i++){
    $a=$plan.runs[$i];$b=$repeated.runs[$i]
    if($a.variant -ne $b.variant -or $a.scenario -ne $b.scenario -or $a.rate -ne $b.rate -or $a.repetition -ne $b.repetition){
        throw 'A mesma semente produziu ordens diferentes.'
    }
}
$knee = & "$PSScriptRoot/../scripts/Benchmark.ps1" -Scenario knee -Rates 500,600,700,800,900,1000 -Repetitions 2 -PlanOnly | ConvertFrom-Json
if($knee.runs.Count -ne 60){throw 'A varredura do joelho deve ter 60 rodadas.'}
foreach($rate in 500,600,700,800,900,1000){
    $cell=@($knee.runs | Where-Object rate -eq $rate)
    if($cell.Count -ne 10){throw "Varredura incompleta em $rate req/s."}
    if(@($cell | Where-Object scenario -eq 'orders').Count -ne 6){throw 'Faltam clientes de pedidos na varredura.'}
    if(@($cell | Where-Object scenario -eq 'db-write').Count -ne 4){throw 'Falta escrita SQL na varredura.'}
}
Write-Host 'Matriz noturna balanceada: 72 rodadas em tres blocos; varredura do joelho com 60.'
