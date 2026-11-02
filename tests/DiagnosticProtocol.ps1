$ErrorActionPreference='Stop'
. "$PSScriptRoot/../scripts/DiagnosticSupport.ps1"
$runner=Join-Path $PSScriptRoot '../scripts/Diagnose-WebFlux.ps1'
$plan=& $runner -PlanOnly | ConvertFrom-Json
if($plan.mainRuns -ne 24 -or $plan.smokeRuns -ne 4){throw 'Plano incorreto.'}
$total=0
foreach($stage in $plan.stages){
    $child=& "$PSScriptRoot/../scripts/Benchmark.ps1" -Scenario orders -Variant $stage.variant -Rates @($stage.rate) -Repetitions $stage.repetitions -MaxVus $stage.vus -Seconds 90 -WarmupSeconds 60 -PlanOnly | ConvertFrom-Json
    $total+=$child.runs.Count
    if($child.seconds -ne 90 -or $child.warmup_seconds -ne 60){throw 'Duracao mudou.'}
}
if($total -ne 24){throw 'Quantidade real difere do plano.'}
$images=(Get-Content -LiteralPath "$PSScriptRoot/../scripts/diagnostic-images.json" -Raw | ConvertFrom-Json).images
$base=New-DiagnosticOverride -Images $images -Stage $plan.stages[0]
$cpu=New-DiagnosticOverride -Images $images -Stage $plan.stages[3]
$cpu.services.webflux.cpus=2
if(($base | ConvertTo-Json -Depth 10 -Compress) -ne ($cpu | ConvertTo-Json -Depth 10 -Compress)){throw 'Experimento CPU alterou outro fator.'}
$vu=New-DiagnosticOverride -Images $images -Stage $plan.stages[2]
if(($base | ConvertTo-Json -Depth 10 -Compress) -ne ($vu | ConvertTo-Json -Depth 10 -Compress)){throw 'Experimento VUs alterou servicos.'}
foreach($stage in $plan.stages){
    $o=New-DiagnosticOverride -Images $images -Stage $stage
    foreach($p in $images.PSObject.Properties){if($o.services[$p.Name].image -ne $p.Value -or $o.services[$p.Name].pull_policy -ne 'never'){throw 'Override nao fixa imagens.'}}
    if($stage.profile -and $o.services[$stage.variant].environment.JAVA_TOOL_OPTIONS -notmatch 'dumponexit=true,filename=/tmp/diagnostic.jfr'){throw 'JFR nao preservado no encerramento.'}
}
$text=Get-Content -LiteralPath "$PSScriptRoot/../scripts/Benchmark.ps1" -Raw
if($text -notmatch '(?s)if\(\$DiagnosticConfigPath\).*?else \{\s*Invoke-Compose -Arguments @\(''build'',''k6''\)'){throw 'Caminho congelado recompila gerador.'}
if($text -notmatch '(?s)Stop-LabApps\s+if\(\$diagnostic -and \$diagnostic.stage.profile\)\{Save-DiagnosticProfile'){throw 'Perfil deve ser salvo depois do stop e antes do recreate.'}
foreach($file in Get-ChildItem -LiteralPath "$PSScriptRoot/../scripts" -Filter '*.ps1'){
    $tokens=$null;$errors=$null
    [Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors) | Out-Null
    if($errors){throw ($errors | Out-String)}
}
Write-Host 'Diagnostico validado: 24 rodadas + 4 smoke, alteracoes isoladas, imagens fixas, JFR e sintaxe.'
