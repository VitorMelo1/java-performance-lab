$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Common.ps1"
Push-Location $LabRoot
try {
    & "$PSScriptRoot/../tests/BenchmarkProtocol.ps1"
    & "$PSScriptRoot/../tests/NightlyProtocol.ps1"
    & "$PSScriptRoot/../tests/InfrastructureState.ps1"
    & "$PSScriptRoot/../tests/ComplementProtocol.ps1"
    & "$PSScriptRoot/../tests/DiagnosticProtocol.ps1"
    $unitTests=@(Get-ChildItem -LiteralPath "$PSScriptRoot/../tests" -Filter '*.test.mjs' | Where-Object {$_.Name -notin @('contract.test.mjs','orders.test.mjs')} | Sort-Object Name | Select-Object -ExpandProperty Name)
    Invoke-Compose -Arguments (@('run','--rm','--no-deps','-T','checker','node','--test') + $unitTests)
    Invoke-Compose -Arguments @('up','-d','--wait','--wait-timeout','90','postgres','upstream')
    Initialize-Orders
    Start-Inventory
    foreach ($variant in $Variants) {
        Start-LabApp $variant
        Reset-LabDatabase
        Reset-Orders
        Reset-Inventory
        Invoke-Compose -Arguments @('run','--rm','-T','-e',"BASE_URL=http://${variant}:8080",'checker','node','--test','contract.test.mjs','orders.test.mjs')
    }
    Write-Host 'Contrato verificado nas tres variantes.'
} finally {
    Stop-LabApps
    Pop-Location
}

