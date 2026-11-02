$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Common.ps1"
Push-Location $LabRoot
try {
    Invoke-Compose -Arguments @('build','mvc-resttemplate','webflux','stock-service','k6')
    Write-Host 'Build e testes concluidos. Aplicacoes e gerador com relogio monotonico estao prontos.'
} finally { Pop-Location }

