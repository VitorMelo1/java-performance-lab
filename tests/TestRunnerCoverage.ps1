$ErrorActionPreference='Stop'
$global:AuditRunnerCaptured=@()
function global:docker {
    if($args[0] -eq 'compose' -and $args[1] -eq 'run'){
        $global:AuditRunnerCaptured+=@($args | Where-Object {$_ -like '*.test.mjs'})
        $global:LASTEXITCODE=0
        return
    }
    if($args[0] -eq 'compose' -and $args[1] -eq 'up'){throw 'TEST_STOP_BEFORE_CONTAINERS'}
    $global:LASTEXITCODE=0
}
try {
    try{& "$PSScriptRoot/../scripts/Test.ps1"}catch{if($_.Exception.Message -notmatch 'TEST_STOP_BEFORE_CONTAINERS'){throw}}
    $expected=@(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.test.mjs' | Where-Object {$_.Name -notin @('contract.test.mjs','orders.test.mjs')} | Select-Object -ExpandProperty Name)
    $missing=@($expected | Where-Object {$_ -notin $global:AuditRunnerCaptured})
    if($missing.Count){throw "Runner omitiu suites: $($missing -join ', ')"}
    Write-Host 'Runner inclui todas as suites unitarias; nenhum container iniciado.'
} finally {Remove-Item Function:\docker; Remove-Variable AuditRunnerCaptured -Scope Global}

