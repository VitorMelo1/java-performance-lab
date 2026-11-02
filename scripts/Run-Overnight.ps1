[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Common.ps1"
$root = Split-Path $PSScriptRoot -Parent
$results = Join-Path $root 'results'
$started = Get-Date
$log = Join-Path $results ("overnight-launch-{0}.log" -f $started.ToString('yyyyMMdd-HHmmss'))

Start-Transcript -LiteralPath $log | Out-Null
try {
    Push-Location $root
    try {
        Write-Host '1/4 Compilando as imagens e executando testes Java...'
        & "$PSScriptRoot/Build.ps1"
        if (!$?) { throw 'Build.ps1 falhou.' }

        Write-Host '2/4 Verificando os contratos nas tres variantes...'
        & "$PSScriptRoot/Test.ps1"
        if (!$?) { throw 'Test.ps1 falhou.' }

        Write-Host '3/4 Fazendo a coleta curta de verificacao...'
        $before = @((Get-ChildItem -LiteralPath $results -Directory | Select-Object -ExpandProperty Name))
        & "$PSScriptRoot/Nightly.ps1" -Quick
        if (!$?) { throw 'Ensaio curto falhou.' }
        $created = @(Get-ChildItem -LiteralPath $results -Directory | Where-Object { $_.Name -notin $before } | Sort-Object CreationTime -Descending)
        if ($created.Count -ne 1) { throw "Esperava um lote curto novo; encontrei $($created.Count)." }
        $batch = $created[0].FullName
        $metadata = Get-Content -LiteralPath (Join-Path $batch 'metadata.json') -Raw | ConvertFrom-Json
        $status = Get-Content -LiteralPath (Join-Path $batch 'status.json') -Raw | ConvertFrom-Json
        $rows = @(Import-Csv -LiteralPath (Join-Path $batch 'results.csv'))
        if ($metadata.protocolVersion -ne $ProtocolVersion) {
            throw "Ensaio curto gravado no protocolo $($metadata.protocolVersion), esperado $ProtocolVersion. Confira $batch."
        }
        if (!$metadata.quick -or $status.state -ne 'complete' -or
            $status.planned -ne 8 -or $status.completed -ne 8 -or $rows.Count -ne 8) {
            throw "Ensaio curto incompleto: estado '$($status.state)', $($status.completed) de $($status.planned) rodadas, $($rows.Count) linhas. Confira $batch."
        }
        foreach ($row in $rows) {
            if ($row.analysis_status -ne 'ok' -or [int]$row.error_count -ne 0 -or
                [int]$row.dropped_iterations -ne 0 -or [int]$row.successful_requests -le 0) {
                throw "Ensaio curto com problema em $($row.run). Confira $batch."
            }
        }

        Write-Host '4/4 Iniciando a coleta noturna de ate 4 horas...'
        & "$PSScriptRoot/Nightly.ps1"
        if (!$?) { throw 'Coleta noturna falhou. Os arquivos gerados foram preservados.' }
        Write-Host 'Coleta encerrada. Consulte a pasta results e o relatorio dentro do lote novo.'
    } finally {
        Pop-Location
    }
} catch {
    Write-Error "Execucao interrompida: $($_.Exception.Message)"
    exit 1
} finally {
    Stop-Transcript | Out-Null
}
