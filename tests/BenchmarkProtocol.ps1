$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../scripts/Common.ps1"
$script = Join-Path $PSScriptRoot '../scripts/Benchmark.ps1'

# A versao do protocolo e escrita em duas linguagens: $ProtocolVersion no PowerShell e
# protocol_version no gerador. Quando subiu de 3 para 4, o portao do Run-Overnight ficou
# exigindo 3 e rejeitou um ensaio curto que passou 8/8. Aqui se verifica que as duas
# concordam e que nenhum script voltou a escrever o numero a mao.
$loadSource = Get-Content -Raw (Join-Path $PSScriptRoot '../benchmarks/load.js')
$generatorVersion = [regex]::Match($loadSource, 'protocol_version:\s*(\d+)').Groups[1].Value
if (!$generatorVersion) { throw 'Nao encontrei protocol_version em benchmarks/load.js.' }
if ([int]$generatorVersion -ne $ProtocolVersion) {
    throw "Gerador grava protocolo $generatorVersion e os scripts esperam $ProtocolVersion. Atualize benchmarks/load.js e scripts/Common.ps1 juntos."
}
foreach ($name in @('Benchmark.ps1','Run-Overnight.ps1','Nightly.ps1','Knee.ps1','Retest.ps1')) {
    $text = Get-Content -Raw (Join-Path $PSScriptRoot "../scripts/$name")
    $literal = [regex]::Match($text, '(?m)protocol(?:Version)?\s*=\s*(\d+)')
    if ($literal.Success) {
        throw "scripts/$name escreve a versao do protocolo a mao ($($literal.Groups[1].Value)); use `$ProtocolVersion de Common.ps1."
    }
}
$plan = & $script -Scenario all -Rates 500,1000 -Repetitions 3 -PlanOnly | ConvertFrom-Json
if ($plan.runs.Count -ne 42) { throw 'Reteste deve incluir as duas implementacoes SQL e os tres clientes HTTP.' }
if (@($plan.runs | Where-Object { $_.warmup_rate -ne $_.rate }).Count) { throw 'Aquecimento deve usar a taxa do cenario, inclusive acima de 100 req/s.' }
if ($plan.seconds -ne 120 -or $plan.warmup_seconds -ne 60) { throw 'Duracoes padrao incorretas.' }
$filtered = & $script -Scenario db-read -Variant webflux -Rates 500 -Repetitions 1 -PlanOnly | ConvertFrom-Json
if ($filtered.runs.Count -ne 1 -or $filtered.runs[0].variant -ne 'webflux') { throw 'Filtro de diagnostico nao selecionou a variante correta.' }
$rejected = $false
try { & $script -Scenario db-read -Variant mvc-feign -PlanOnly | Out-Null } catch { $rejected = $true }
if (!$rejected) { throw 'Nao deve permitir uma variante que nao faz parte do cenario.' }
$quick = & $script -Scenario all -Quick -PlanOnly | ConvertFrom-Json
if ($quick.runs.Count -ne 7 -or $quick.seconds -ne 5 -or $quick.warmup_seconds -ne 3) { throw 'Ensaio curto deve permanecer separado da coleta.' }

# Add-Member recusa um campo que ja exista no objeto, e o row.json da medicao e a base do
# result.json. Quando load.js passou a emitir warmup_shape em toda execucao, o harness
# abortou na primeira rodada da coleta com "a member with that name already exists".
# Nenhum teste cobria esse contrato: um lado lia load.js, o outro o PowerShell.
$load = Get-Content -Raw (Join-Path $PSScriptRoot '../benchmarks/load.js')
$start = $load.IndexOf('const row = {')
if ($start -lt 0) { throw 'Nao encontrei o literal do row em load.js.' }
$end = $load.IndexOf("`n  };", $start)
if ($end -lt 0) { throw 'Nao encontrei o fim do literal do row em load.js.' }
$body = $load.Substring($start, $end - $start)
# Comentario pode citar um campo seguido de dois-pontos; string pode conter qualquer coisa.
$body = [regex]::Replace($body, '//[^\r\n]*', '')
$body = [regex]::Replace($body, "'[^']*'", "''")
$body = [regex]::Replace($body, '"[^"]*"', '""')
$named = @([regex]::Matches($body, '\b([a-z_][a-z0-9_]*):') | ForEach-Object { $_.Groups[1].Value })
# `requests` e propriedade shorthand no row (sem dois-pontos). Sem varrer essa forma, um
# Add-Member com esse nome passaria pela verificacao e falharia so durante a coleta.
$shorthand = @($body.Substring($body.IndexOf('{') + 1) -split '[,\r\n]' | ForEach-Object { $_.Trim() } |
    Where-Object { $_ -match '^[a-z_][a-z0-9_]*$' })
$rowKeys = @($named + $shorthand | Sort-Object -Unique)
# Sanidade com campos estaveis apenas: se a assertiva citasse load_shape, uma colisao
# reintroduzida nesse campo falharia aqui, com mensagem enganosa, em vez de na checagem
# de colisao abaixo, que e a que explica o problema.
if ($rowKeys -notcontains 'protocol_version' -or $rowKeys -notcontains 'requests') {
    throw "Extracao dos campos do row falhou: $($rowKeys -join ',')"
}
$harness = Get-Content -Raw $script
$added = @([regex]::Matches($harness, 'Add-Member\s+NoteProperty\s+([A-Za-z_][A-Za-z0-9_]*)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
if ($added -notcontains 'warmup_shape') { throw 'Extracao dos Add-Member falhou.' }
$collisions = @($added | Where-Object { $rowKeys -contains $_ })
if ($collisions.Count) {
    throw "O harness acrescenta campos que o gerador ja emite, e Add-Member vai falhar na coleta: $($collisions -join ', ')"
}

Write-Host "8 verificacoes do protocolo passaram (versao $ProtocolVersion em PowerShell e no gerador, $($rowKeys.Count) campos do gerador, $($added.Count) do harness, sem colisao)."
