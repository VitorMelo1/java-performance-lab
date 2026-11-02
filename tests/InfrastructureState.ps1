$ErrorActionPreference='Stop'
. "$PSScriptRoot/../scripts/Common.ps1"
$before=@([pscustomobject]@{Id='app';Name='app';RestartCount=0;State=@{Running=$true;OOMKilled=$false}})
Assert-LabServices -Before $before -After $before
$json='[{"Id":"a","Name":"a","RestartCount":0,"State":{"Running":true,"OOMKilled":false}},{"Id":"b","Name":"b","RestartCount":0,"State":{"Running":true,"OOMKilled":false}}]'
Assert-LabServices -Before @($json | ConvertFrom-Json) -After @($json | ConvertFrom-Json)
foreach($state in @(@{Running=$false;OOMKilled=$false},@{Running=$false;OOMKilled=$true})){
    $caught=$false
    try{Assert-LabServices -Before $before -After @([pscustomobject]@{Id='app';Name='app';RestartCount=0;State=$state})}catch{$caught=$true}
    if(!$caught){throw 'Queda de servico nao foi detectada.'}
}
$caught=$false
try{Assert-LabServices -Before $before -After @([pscustomobject]@{Id='app';Name='app';RestartCount=1;State=@{Running=$true;OOMKilled=$false}})}catch{$caught=$true}
if(!$caught){throw 'Reinicio nao detectado.'}
Write-Host 'Estado posterior distingue queda/reinicio de saturacao.'
