. "$PSScriptRoot/../scripts/Common.ps1"
Push-Location $LabRoot
try {
    foreach ($expected in @(0,7)) {
        $log = Join-Path $LabRoot "results/native-exit-$expected.log"
        $actual = Invoke-DockerLogged -Arguments @('compose','run','--rm','-T','checker','node','native-exit.mjs',"$expected") -LogPath $log
        if ($actual -ne $expected) { throw "Exit code incorreto: esperado $expected, recebido $actual" }
        if (!((Get-Content $log -Raw) -match 'expected diagnostic on stderr')) { throw 'stderr nao foi preservado' }
    }
    Write-Host 'stderr e codigos de saida preservados.'
} finally { Pop-Location }
