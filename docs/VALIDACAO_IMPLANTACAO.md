# Evidências da preparação para implantação

Escopo: checkout FUNIX e Docker local de desenvolvimento. Nenhum acesso SSH à VPS, mudança em DNS, deploy, publicação GHCR, configuração de secrets ou alteração de outros serviços foi executado nesta preparação.

## Verificações executadas

| Verificação | Resultado |
|---|---|
| `npm run check` | Build Vite/TypeScript e tipagem backend passaram; testes Node passaram; quatro avisos preexistentes de lint em `src/App.tsx`, sem erros |
| Casos adicionais de startup de produção | Verificados em subprocessos, sem abrir listener: senha ausente/longa demais e origem HTTP são recusadas sem imprimir a senha |
| `python3 -m unittest discover -s deploy/tests -v` | 7 testes de deploy/rollback/restrição passaram, com Docker simulado e caminhos temporários |
| Sintaxe Bash | `bash -n` passou nos três scripts |
| Docker API, target `api` | Imagem Node 24 construída localmente |
| Docker web, target `web` | Imagem multistage construída; Vite gera arquivos e Nginx os serve sem root |
| Smoke tests das imagens | Ambos healthy, sem portas de host, root filesystem readonly, capacidades removidas, dados sintéticos |
| Autenticação na imagem API | Leitura sem sessão 401; origem incorreta 403; login HTTPS 200 e cookie Secure; ausência de Coda 503 explícito; escrita de negócio 405 |
| Servidor web | Fallback SPA funciona; `/api/session` e asset inexistente retornam 404; `release.json` está presente |
| Compose | `docker compose config --quiet` passou usando cópia do Compose com caminho de env_file temporário; nenhum arquivo da VPS ou `/etc/funix` real foi usado |
| Workflow | Actionlint 1.7.7 passou, além da leitura YAML e inspeção das condições/permissions; actions resolvidas por SHA |
| GitHub Actions no PR #1 | [Execução 39892824820](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/actions/runs/39892824820): job `validate` passou, incluindo build, 14 testes Node, 7 testes de recuperação, ambas as imagens, smoke e Compose; `publish` e `deploy` foram ignorados por ser PR |
| Sigilo e escopo | `.dockerignore` usa lista permitida; `.env`/runtime real não versionados; imagens não recebem segredo por build arg; varredura dos arquivos alterados não encontrou chaves privadas/tokens |
| Diff | `git diff --check` passou; nenhum arquivo da interface foi modificado |

## Casos de recuperação exercitados

- Atualização limitada ao project-name `funixapp`, dois serviços, repositórios de imagem fixos e digests.
- Registro da release e estado somente após saúde; estado atual/anterior substituído por rename.
- Falha ao subir nova release: restaura anterior e não avança o registro de sucesso.
- Primeira release sem versão anterior: falha para apenas os dois serviços FUNIX.
- Rollback manual troca o par de imagens e mantém a versão de origem para retorno.
- SHA/digest inválidos, path traversal e comandos arbitrários não chegam ao Docker.
- Mesma revisão não pode ser substituída silenciosamente por outro digest.
- Comando SSH forçado rejeita shell, Docker direto, quebra de linha e injeção de comando.

Os testes do script executam uma cópia com caminhos fixos remapeados para um diretório temporário e executável Docker falso. Não substituem o teste real de SSH/sudo/registry na VPS.

## Problemas encontrados e corrigidos

1. API só escutava loopback: adicionado host configurável, mantendo padrão local e definindo `0.0.0.0` somente no Compose/imagem.
2. Configuração Nginx herdou permissão que impedia leitura pelo usuário não root: Dockerfile fixa `COPY --chmod=0644`.
3. Wget do health check usava o proxy do ambiente gerenciado até para loopback: uso explícito de `-Y off` apenas nessas verificações locais. O proxy de chamadas externas da API foi preservado.
4. Produção não possuía readiness separada: adicionada `/api/ready`, sem consulta remota ou credenciais na resposta.
5. Sessão local requer origem exata: Compose fixa HTTPS na origem pública, independentemente de o tráfego interno Traefik→API ser HTTP.

## Não certificado nesta preparação

Push/leitura privada GHCR; autenticação SSH e sudo efetivos; configuração real de Traefik/Cloudflare/certificado; capacidade livre na VPS; conexão REST autenticada do Coda. O roteamento HTTPS da VPS é validado pelo smoke público do workflow somente após autorização. Não foi executado teste local de Traefik ou ACME.

A interface continua com os limites funcionais anteriores. Readiness não significa conectividade Coda ou módulo comercial completo. Sessões em memória e limite de tentativas compartilhado atrás do proxy são limitações explicitadas no guia de implantação.
