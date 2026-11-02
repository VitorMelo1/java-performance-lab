param(
    [string]$GithubUrl = '',
    [string]$ZenodoDoi = ''
)
$ErrorActionPreference = 'Stop'
$projectPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$publicationPath = Join-Path $projectPath 'docs/publicacao'
$linksPath = Join-Path $publicationPath 'links.json'
$metadataPath = Join-Path $publicationPath 'metadados.json'
$links = Get-Content -LiteralPath $linksPath -Raw -Encoding UTF8 | ConvertFrom-Json
$metadata = Get-Content -LiteralPath $metadataPath -Raw -Encoding UTF8 | ConvertFrom-Json
$interactiveMode = $PSBoundParameters.Count -eq 0
if ($interactiveMode) {
    $GithubUrl = Read-Host 'URL do repositorio GitHub (Enter preserva o valor salvo)'
    $ZenodoDoi = Read-Host 'DOI do artigo, somente depois de publicado (Enter deixa pendente ou preserva o salvo)'
}
if ([string]::IsNullOrWhiteSpace($GithubUrl)) { $GithubUrl = [string]$links.github_url }
if ([string]::IsNullOrWhiteSpace($ZenodoDoi)) { $ZenodoDoi = [string]$links.zenodo_doi }
$GithubUrl = $GithubUrl.Trim().TrimEnd('/') -replace '\.git$',''
$ZenodoDoi = $ZenodoDoi.Trim() -replace '^https://doi\.org/',''
if ($GithubUrl -notmatch '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
    throw 'Informe a URL real: https://github.com/usuario/repositorio. Nenhum arquivo foi alterado.'
}
if ($ZenodoDoi -and $ZenodoDoi -notmatch '^10\.\d{4,9}/[-._;()/:A-Za-z0-9]+$') {
    throw 'DOI invalido. Use o identificador real 10.xxxx/... ou o link https://doi.org/... . Nenhum arquivo foi alterado.'
}
$linkData = [ordered]@{ github_url=$GithubUrl; zenodo_doi=$ZenodoDoi }
$linkJson = $linkData | ConvertTo-Json
$readmePath = Join-Path $projectPath 'README.md'
$pagePath = Join-Path $projectPath 'PUBLICAR.html'
$citationPath = Join-Path $projectPath 'CITATION.cff'
$readme = Get-Content -LiteralPath $readmePath -Raw -Encoding UTF8
$page = Get-Content -LiteralPath $pagePath -Raw -Encoding UTF8
$citation = Get-Content -LiteralPath $citationPath -Raw -Encoding UTF8
$readmePattern = '(?s)<!-- publication-links:start -->.*?<!-- publication-links:end -->'
$pagePattern = '(?s)<script id="publication-links" type="application/json">.*?</script>'
if (-not [regex]::IsMatch($readme,$readmePattern) -or -not [regex]::IsMatch($page,$pagePattern)) {
    throw 'Marcadores de publicacao ausentes. Nenhum arquivo foi alterado.'
}
$articleLine = 'Artigo: deposito publico ainda pendente; nenhum DOI foi informado.'
if ($ZenodoDoi) { $articleLine = "Artigo (preprint): [https://doi.org/$ZenodoDoi](https://doi.org/$ZenodoDoi)." }
$block = @"
<!-- publication-links:start -->
## Publicacao e codigo

Codigo-fonte: [$GithubUrl]($GithubUrl).

$articleLine

Abra [PUBLICAR.html](PUBLICAR.html) para os campos do Zenodo e [o guia](docs/publicacao/COMO-PUBLICAR.md) para conferir os arquivos. As coletas historicas usam versoes discriminadas no artigo; o codigo atual nao substitui seus manifestos.

<!-- publication-links:end -->
"@
$readme = [regex]::Replace($readme,$readmePattern,[System.Text.RegularExpressions.MatchEvaluator]{param($m) $block})
$pageBlock = '<script id="publication-links" type="application/json">' + $linkJson + '</script>'
$page = [regex]::Replace($page,$pagePattern,[System.Text.RegularExpressions.MatchEvaluator]{param($m) $pageBlock})
$citation = [regex]::Replace($citation,'(?s)\r?\n# publication-links:start.*?# publication-links:end\r?\n?','')
$citationBlock = "`n# publication-links:start`nrepository-code: " + ($GithubUrl | ConvertTo-Json -Compress) + "`n"
if ($ZenodoDoi) {
    $citationBlock += "preferred-citation:`n  type: generic`n  title: " + ($metadata.title | ConvertTo-Json -Compress) + "`n  doi: " + ($ZenodoDoi | ConvertTo-Json -Compress) + "`n  authors:`n"
    foreach ($author in $metadata.authors) {
        $citationBlock += '    - family-names: ' + ($author.family_names | ConvertTo-Json -Compress) + "`n      given-names: " + ($author.given_names | ConvertTo-Json -Compress) + "`n"
    }
}
$citation += $citationBlock + "# publication-links:end`n"
$description = $metadata.abstract + "`n`nO deposito reune o manuscrito, material suplementar e 302 series de medicao. Os resultados distinguem versoes e condicoes experimentais.`n`nCodigo-fonte e instrucoes de reproducao: $GithubUrl`n"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($linksPath,$linkJson,$utf8)
[IO.File]::WriteAllText($readmePath,$readme,$utf8)
[IO.File]::WriteAllText($pagePath,$page,$utf8)
[IO.File]::WriteAllText($citationPath,$citation,$utf8)
[IO.File]::WriteAllText((Join-Path $publicationPath 'descricao-zenodo.txt'),$description,$utf8)
Write-Host 'Links gravados em README.md, CITATION.cff, PUBLICAR.html e docs/publicacao.'
Write-Host 'Reabra PUBLICAR.html para copiar a descricao com o GitHub.'
Write-Host 'Nenhum commit, push, upload ou publicacao foi realizado. Confira se as URLs informadas abrem publicamente.'
