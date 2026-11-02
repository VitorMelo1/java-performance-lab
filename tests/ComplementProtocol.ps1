$ErrorActionPreference='Stop'
foreach($session in 'A','B') {
    $p = & "$PSScriptRoot/../scripts/Complement.ps1" -Session $session -PlanOnly | ConvertFrom-Json
    $reps = if($session -eq 'A') {3} else {2}
    if($p.runs.Count -ne (10*$reps)){throw 'Quantidade incorreta de rodadas complementares.'}
    if($p.seconds -ne 90 -or $p.warmup_seconds -ne 60 -or $p.max_vus -ne 500){throw 'Parametros diferentes do lote original.'}
    if($p.session -ne "complement-$session"){throw 'Sessao nao identificada.'}
    foreach($rep in 1..$reps){
        $block=@($p.runs|Where-Object repetition -eq $rep)
        if($block.Count -ne 10){throw 'Bloco incompleto.'}
        foreach($rate in 500,1000){
            $arms=@($block|Where-Object {$_.scenario -eq 'orders' -and $_.rate -eq $rate})
            if(($arms.variant|Sort-Object) -join ',' -ne 'mvc-feign,mvc-resttemplate,webflux'){throw 'Clientes de pedidos incompletos.'}
        }
        foreach($scenario in 'db-read','db-write'){
            $arms=@($block|Where-Object {$_.scenario -eq $scenario})
            if($arms.Count -ne 2 -or @($arms|Where-Object rate -ne 1000).Count){throw 'Recorte SQL incorreto.'}
        }
    }
    $last=0
    foreach($run in $p.runs){if($run.repetition -lt $last){throw 'Blocos intercalados.'};$last=$run.repetition}
    $repeat = & "$PSScriptRoot/../scripts/Complement.ps1" -Session $session -PlanOnly | ConvertFrom-Json
    if(($p|ConvertTo-Json -Depth 8 -Compress) -ne ($repeat|ConvertTo-Json -Depth 8 -Compress)){throw 'Sorteio nao reproduzivel.'}
}
Write-Host 'Complemento validado sem carga: A=30, B=20; blocos completos, parametros preservados e sorteio reproduzivel.'
