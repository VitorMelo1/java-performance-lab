param([ValidateSet('mvc-resttemplate','mvc-feign','webflux')][string]$Variant='mvc-resttemplate')
. "$PSScriptRoot/Common.ps1"
Push-Location $LabRoot
try {
    Start-LabApp $Variant
    Write-Host "API pronta: http://localhost:$($Ports[$Variant])/api/products/1"
    Write-Host "HTTP externo: http://localhost:$($Ports[$Variant])/api/remote/1?delayMs=100"
} finally { Pop-Location }

