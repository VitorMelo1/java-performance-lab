$ErrorActionPreference='Stop'

function Get-DiagnosticStages {
    # Each stage is a separate batch; never pool different interventions.
    @(
        [pscustomobject]@{name='baseline';variant='all';rate=1000;repetitions=3;vus=500;cpu=2;profile=$false;generator='20'},
        [pscustomobject]@{name='webflux-500';variant='webflux';rate=500;repetitions=3;vus=500;cpu=2;profile=$false;generator='20'},
        [pscustomobject]@{name='webflux-vus1000';variant='webflux';rate=1000;repetitions=3;vus=1000;cpu=2;profile=$false;generator='20'},
        [pscustomobject]@{name='webflux-cpu4';variant='webflux';rate=1000;repetitions=3;vus=500;cpu=4;profile=$false;generator='20'},
        [pscustomobject]@{name='webflux-gerador15';variant='webflux';rate=1000;repetitions=3;vus=500;cpu=2;profile=$false;generator='15'},
        [pscustomobject]@{name='perfil-webflux';variant='webflux';rate=1000;repetitions=1;vus=500;cpu=2;profile=$true;generator='20'},
        [pscustomobject]@{name='perfil-mvc';variant='mvc-resttemplate';rate=1000;repetitions=1;vus=500;cpu=2;profile=$true;generator='20'},
        [pscustomobject]@{name='baseline-final';variant='webflux';rate=1000;repetitions=1;vus=500;cpu=2;profile=$false;generator='20'}
    )
}

function New-DiagnosticOverride {
    param($Images,$Stage)
    $services=[ordered]@{}
    foreach($entry in $Images.PSObject.Properties) {
        $services[$entry.Name]=[ordered]@{image=$entry.Value;pull_policy='never'}
    }
    $services['webflux']['cpus']=$Stage.cpu
    # CPU experiment changes quota ONLY: heap, pools and ActiveProcessorCount=2 stay fixed.
    if($Stage.profile) {
        $services[$Stage.variant]['environment']=@{JAVA_TOOL_OPTIONS='-Xms512m -Xmx512m -XX:+UseG1GC -XX:ActiveProcessorCount=2 -Xlog:gc+init=info:stderr -XX:StartFlightRecording=name=diagnostic,settings=profile,dumponexit=true,filename=/tmp/diagnostic.jfr,maxsize=128m'}
        $services[$Stage.variant]['stop_grace_period']='60s'
    }
    return @{services=$services}
}

function Assert-DiagnosticConfig {
    param($Config,$Images,$Stage)
    foreach($entry in $Images.PSObject.Properties) {
        $service=$Config.services.($entry.Name)
        if($service.image -ne $entry.Value -or $service.pull_policy -ne 'never') {throw "Imagem nao congelada: $($entry.Name)"}
    }
    if([double]$Config.services.webflux.cpus -ne $Stage.cpu){throw 'Cota de CPU incorreta.'}
    foreach($arm in @('mvc-resttemplate','mvc-feign','webflux')) {
        $flags=$Config.services.$arm.environment.JAVA_TOOL_OPTIONS
        if($flags -notmatch '-XX:ActiveProcessorCount=2' -or $flags -notmatch '-Xmx512m'){throw "Flags inesperadas: $arm"}
        $hasProfile=$flags -match 'StartFlightRecording'
        if($hasProfile -ne ($Stage.profile -and $arm -eq $Stage.variant)){throw "Perfil na condicao incorreta: $arm"}
    }
}

function Save-DiagnosticCgroup {
    param([string]$Variant,[string]$Path)
    # v2 cpu.stat includes nr_throttled/throttled_usec; record availability, never invent zero.
    $code=Invoke-DockerLogged -Arguments @('compose','exec','-T',$Variant,'sh','-c','date -u; cat /sys/fs/cgroup/cpu.max /sys/fs/cgroup/cpu.stat /sys/fs/cgroup/cpu.pressure /sys/fs/cgroup/memory.events') -LogPath $Path
    if($code -ne 0){Add-Content -LiteralPath $Path -Value 'diagnostic_unavailable: one or more cgroup v2 files could not be read'}
}

function Save-DiagnosticProfile {
    param([string]$Variant,[string]$Directory)
    # Called AFTER graceful stop and BEFORE the next force-recreate.
    $id=(& docker compose ps --all -q $Variant | Out-String).Trim()
    if($LASTEXITCODE -ne 0 -or !$id){throw 'Container do perfil nao encontrado.'}
    & docker cp "${id}:/tmp/diagnostic.jfr" (Join-Path $Directory 'diagnostic.jfr')
    if($LASTEXITCODE -ne 0){throw "Perfil JFR ausente em $Directory; logs e dados preservados."}
    $file=Join-Path $Directory 'diagnostic.jfr'
    $stream=[IO.File]::OpenRead($file)
    try{$header=New-Object byte[] 4; $count=$stream.Read($header,0,4)}finally{$stream.Dispose()}
    if($count -ne 4 -or ($header -join ',') -ne '70,76,82,0'){throw 'Arquivo JFR sem cabecalho valido.'}
}
