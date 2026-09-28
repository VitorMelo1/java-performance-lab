$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Common.ps1"
Push-Location $LabRoot
try {
    Invoke-Compose -Arguments @('up','-d','--wait','--wait-timeout','90','postgres','upstream')
    foreach ($variant in $Variants) {
        Start-LabApp $variant
        Reset-LabDatabase
        Invoke-Compose -Arguments @('run','--rm','-T','-e',"BASE_URL=http://${variant}:8080",'checker')
    }
    Write-Host 'Contrato verificado nas tres variantes.'
} finally {
    Stop-LabApps
    Pop-Location
}

