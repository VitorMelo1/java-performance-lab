$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Common.ps1"
Push-Location $LabRoot
try {
    Invoke-Compose -Arguments @('build','mvc-resttemplate','webflux')
    Write-Host 'Build e testes unitarios concluidos. As duas imagens estao prontas.'
} finally { Pop-Location }

