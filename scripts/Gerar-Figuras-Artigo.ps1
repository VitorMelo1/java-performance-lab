param([string]$PythonExe = '')
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path $PSScriptRoot -Parent
$sourcePath = Join-Path $projectPath 'docs/entrega-artigo'
$outputPath = Join-Path $projectPath 'results/figuras-artigo-reproduzidas'
$pythonArgs = @()
if (-not $PythonExe) {
    if (Get-Command py -ErrorAction SilentlyContinue) { $PythonExe = 'py'; $pythonArgs = @('-3') }
    elseif (Get-Command python -ErrorAction SilentlyContinue) { $PythonExe = 'python' }
    else { throw 'Instale Python 3 com matplotlib, ou informe -PythonExe com o caminho do executavel.' }
}
& $PythonExe @pythonArgs -c 'import matplotlib'
if ($LASTEXITCODE -ne 0) { throw 'Matplotlib indisponivel nesse Python. Instale com: python -m pip install matplotlib (ou py -3 -m pip install matplotlib).' }
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
$inputs=@('new-data.json','article-data.json','document-config.json','new-raw-validation.json','20261015-011234-1ceec5.json','20261020-020913-fbd4ad.json','dados-das-figuras.csv','gerar-graficos.py','conferir-tabelas.py')
foreach($name in $inputs){Copy-Item -LiteralPath (Join-Path $sourcePath $name) -Destination (Join-Path $outputPath $name) -Force}
& $PythonExe @pythonArgs (Join-Path $outputPath 'gerar-graficos.py')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar as figuras.' }
& $PythonExe @pythonArgs (Join-Path $outputPath 'conferir-tabelas.py')
if ($LASTEXITCODE -ne 0) { throw 'Falha na conferencia dos pontos.' }
Write-Host "Sete figuras PNG/SVG geradas e conferidas em: $outputPath"
Write-Host 'Dados: resultados preservados das coletas identificadas no artigo. Nenhuma nova carga de teste foi iniciada.'
Write-Host 'O PDF e o pacote de publicacao permanecem intactos; esta pasta permite reproduzir as figuras.'
