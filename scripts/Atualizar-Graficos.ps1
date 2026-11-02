$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
    if(Get-Command node -ErrorAction SilentlyContinue){
        & node (Join-Path $root 'benchmarks/catalog.mjs') (Join-Path $root 'results')
    } else {
        & docker compose run --rm --no-deps -T checker node /benchmarks/catalog.mjs /results
    }
    if($LASTEXITCODE -ne 0){throw 'Nao foi possivel atualizar a central de graficos.'}
    Write-Host "Abra: $(Join-Path $root 'GRAFICOS.html')"
} finally {Pop-Location}
