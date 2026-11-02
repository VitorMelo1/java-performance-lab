param([Parameter(Mandatory=$true)][string]$ProjectRoot)
$ErrorActionPreference='Stop'
. "$PSScriptRoot/../scripts/DiagnosticSupport.ps1"
$docker='C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$images=(Get-Content -LiteralPath "$PSScriptRoot/../scripts/diagnostic-images.json" -Raw | ConvertFrom-Json).images
$override=Join-Path ([IO.Path]::GetTempPath()) ('diagnostic-validate-'+[guid]::NewGuid().ToString('N')+'.json')
try {
 foreach($stage in Get-DiagnosticStages){
    New-DiagnosticOverride -Images $images -Stage $stage | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 $override
    $raw=& $docker compose --profile '*' --project-directory $ProjectRoot -f "$ProjectRoot/compose.yaml" -f $override config --format json
    if($LASTEXITCODE -ne 0){throw 'Compose rejeitou override.'}
    $config=($raw | Out-String) | ConvertFrom-Json
    Assert-DiagnosticConfig -Config $config -Images $images -Stage $stage
    foreach($arm in @('mvc-resttemplate','mvc-feign','webflux')) {
        if([long]$config.services.$arm.mem_limit -ne 1073741824){throw 'Memoria alterada.'}
        if($config.services.$arm.environment.DB_POOL_SIZE -ne '20' -or $config.services.$arm.environment.HTTP_POOL_SIZE -ne '100'){throw 'Pools alterados.'}
    }
    $config.services.webflux.image='mutable:tag'
    $rejected=$false
    try{Assert-DiagnosticConfig -Config $config -Images $images -Stage $stage}catch{$rejected=$true}
    if(!$rejected){throw 'Guarda aceitou imagem mutavel.'}
 }
 Write-Host 'Oito overrides validados pelo Docker Compose sem daemon: cotas, flags, pools, memoria, imagens e rejeicao de divergencia.'
} finally {Remove-Item -LiteralPath $override -ErrorAction SilentlyContinue}

