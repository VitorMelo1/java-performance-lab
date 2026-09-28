$ErrorActionPreference = 'Stop'
$LabRoot = Split-Path $PSScriptRoot -Parent
$Variants = @('mvc-resttemplate', 'mvc-feign', 'webflux')
$Ports = @{'mvc-resttemplate'=18081; 'mvc-feign'=18082; 'webflux'=18083}

function Invoke-DockerLogged {
    param([string[]]$Arguments, [string]$LogPath)
    $previousPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5.1 transforma stderr nativo em ErrorRecord.
        # Docker usa stderr para progresso normal; quem decide falha e o exit code.
        $ErrorActionPreference = 'Continue'
        & docker @Arguments *> $LogPath
        $nativeExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    return $nativeExitCode
}

function Invoke-Compose {
    param([string[]]$Arguments)
    & docker compose @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose falhou ($LASTEXITCODE): $Arguments" }
}
function Wait-App {
    param([string]$Variant)
    $url = "http://127.0.0.1:$($Ports[$Variant])/actuator/health"
    for ($attempt=0; $attempt -lt 90; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri $url -TimeoutSec 2
            if ($health.status -eq 'UP') { return }
        } catch {}
        Start-Sleep -Seconds 1
    }
    & docker compose logs --tail 80 $Variant
    throw "Aplicacao $Variant nao ficou pronta."
}
function Stop-LabApps {
    Invoke-Compose -Arguments (@('stop') + $Variants)
}
function Start-LabApp {
    param([string]$Variant)
    Stop-LabApps
    Invoke-Compose -Arguments @('up','-d','--no-build','--force-recreate',$Variant)
    Wait-App $Variant
}
function Reset-LabDatabase {
    $sql = "SET statement_timeout = 0; TRUNCATE products RESTART IDENTITY; INSERT INTO products(name, price_cents, stock) SELECT 'Produto ' || i, 1000 + i, 100 FROM generate_series(1,10000) AS i;"
    $sql | & docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U lab -d lab
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao restaurar os dados do laboratorio.' }
    & docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U lab -d lab -c 'SET statement_timeout = 0' -c 'VACUUM ANALYZE products;'
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao analisar os dados do laboratorio.' }
}

