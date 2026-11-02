# Publicar o artigo e vincular o GitHub

Abra PUBLICAR.html na raiz do projeto. A página funciona localmente e não envia nenhum arquivo por conta própria.

## 1. Repositório do código

Crie um repositório no GitHub e envie este projeto. O Git não tem remote configurado nesta cópia no momento da preparação. results/, target/, .env, backups de artigo e todos os Dados-brutos.zip ficam ignorados. Material-suplementar.zip (~15 MiB), PDF, DOCX e gráficos podem acompanhar o código. Não force a inclusão dos dados brutos: são ~2,9 GiB e vão no Zenodo.

O código atual e as imagens recompiladas não reproduzem necessariamente todos os binários históricos: a matriz completa de 31/10 usava Temurin 21.0.13+9; os Dockerfiles atuais fixam 21.0.12.1+1. Consulte manifests e Tabela 2 antes de comparar uma nova execução.

Depois de criar o repositório, execute no CMD, dentro da pasta do projeto:

```bat
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Vincular-Publicacao.ps1"
```

Cole a URL real quando solicitado. Isso atualiza README.md, CITATION.cff, a página PUBLICAR.html e a descrição para o Zenodo. Não faz commit, push, upload ou publicação. A URL deve ser a página https://github.com/usuario/repositorio. O script não verifica se o repositório já está público; confira no navegador sem autenticação.

Para conferir antes de enviar código:

```bat
git status --short
git diff --check
git add .
git diff --cached --stat
```

Revise a lista e então crie seu commit. Configure origin com a URL real se ainda não existir e faça push da sua branch. Não use git add -f para os ZIPs de dados. Escolha uma licença do código com os coautores antes de anunciá-lo como software de código aberto; nenhum LICENSE foi imposto automaticamente.

## 2. Zenodo

Entre em https://zenodo.org/uploads/new. Envie os três arquivos de docs/entrega-artigo:

1. Artigo-Spring-MVC-WebFlux.pdf.
2. Material-suplementar.zip.
3. Dados-brutos.zip — aguarde o upload completo (~2,9 GiB).

Selecione Publication / Preprint. Copie título, autores, resumo e palavras-chave da página PUBLICAR.html. Idioma: português. A data de publicação é a primeira disponibilização pública, não necessariamente a data da coleta ou da preparação dos arquivos. Como ainda não existe DOI desse artigo, indique que não possui DOI; o Zenodo o atribui na publicação. Não invente ORCID, afiliação, revista, ISSN, volume ou aceite.

Inclua a URL real do GitHub na descrição, usando o texto gerado pelo script. Se o formulário oferecer Related works, adicione a URL como recurso relacionado de software, sem marcar os dois objetos como idênticos. O artigo e o código são objetos distintos. O GitHub pode estar nos metadados do depósito sem inserir um endereço provisório no PDF científico.

A licença CC BY 4.0 é uma sugestão para o artigo e a documentação: permite compartilhamento e adaptação com atribuição. Confirme a escolha com os coautores e preserve os avisos de terceiros do código. Esta preparação não aplicou licença nova aos arquivos. O Word é editável e não precisa ser enviado se o PDF estiver correto.

Salve o rascunho, confira a prévia e as três transferências, e publique. A publicação gera registro público e DOI; não representa revisão por pares ou certificado de revista. Confira com o professor se esse comprovante atende à disciplina.

## 3. Depois de publicar

Copie o DOI real. Execute novamente Vincular-Publicacao.ps1 e informe o DOI, ou passe -ZenodoDoi no terminal. O script vincula o artigo no README e em preferred-citation do CITATION.cff, sem atribuir o DOI do artigo ao software. Faça novo commit/push dessas ligações.

Abra a página pública do Zenodo, confira os três autores e salve a página em PDF pelo navegador (Ctrl+P). Guarde DOI, link e essa impressão como comprovante do depósito; não a apresente como certificado emitido pelo Zenodo. Atualize os metadados do Zenodo com o link de uma tag/release do GitHub se quiser fixar uma versão do código.

## Conferências concluídas

16 páginas, cinco figuras e quatro tabelas; sete gráficos na galeria. 175 novas séries brutas e 355 pontos conferidos. 302 séries preservadas no pacote. Os resultados históricos com falhas permanecem discriminados. Não há nova carga de teste nem publicação automática neste preparo.

Fontes: https://help.zenodo.org/docs/deposit/create-new-upload/ e https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-citation-files
