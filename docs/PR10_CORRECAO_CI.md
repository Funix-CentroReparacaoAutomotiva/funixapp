# PR #10 — correção da CI e preparação da primeira publicação

Branch `integracao/mvp-comercial-main`, partindo do commit analisado `738c4a2e6e0bcae03f8c55606370850877e6c755`. Nenhum merge, deploy, acesso à VPS ou alteração de sistemas produtivos foi realizado.

## Causa e correção mínima

O [run com falha](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/actions/runs/40260342074), job `121371155651`, passou por build, testes e smoke Docker. A única falha foi o assert Python do bind no step **Validate production Compose without printing secrets**.

Reprodução com Docker Compose 2.40.3: o YAML `bind: {create_host_path: false}` normaliza para JSON `"bind": {}`. O acesso `.get("create_host_path")` retorna `None`, portanto `== False` falhava. O caminho do banco, a origem/target do bind e a lista de serviços estavam corretos.

Alteração de uma linha no workflow: `.get("create_host_path", False) is False`. Aceita a omissão do booleano falso no JSON normalizado, sem aceitar `true`. O teste negativo com YAML `create_host_path: true` produz JSON com `true` e continua sendo recusado. Não foi removido o `create_host_path: false` do Compose, nem flexibilizada a validação do caminho persistente ou do escopo de serviços.

`deploy/tests/test_compose_config.py` executa a expressão real do workflow, não uma cópia do validador. Cobre falso omitido/expresso, true recusado, banco temporário/em memória, bind ausente/incorreto e serviços alheios. Exercita também a expressão real do job deploy no subconjunto booleano usado por ela.

## Persistência e preservação

- Compose: `/var/lib/funix/app-data` do host montado em `/data`, gravável pela API UID/GID 1000. SQLite configurado como `/data/funix.sqlite`; arquivo 0600. O tmpfs `/tmp` é separado. Nenhum arquivo de banco integra esta entrega.
- Ensaio local: construir imagem API da branch, montar um diretório **temporário sintético** em `/data`, criar Atendimento pela API autenticada, parar/remover o contêiner, criar outro com o mesmo bind e recuperar Atendimento/cenário. Rede `none`, sem portas de host, filesystem somente leitura, cap-drop e no-new-privileges. Os dois contêineres e dados de QA foram removidos ao concluir. A temporariedade do harness não é configuração de produção.
- `deploy/test-containers.sh` usa SQLite em `/tmp` somente para seu smoke descartável. A configuração produtiva não usa esse caminho.
- Nenhum arquivo funcional em `server/`, `src/`, `shared/`, Dockerfile ou Compose foi alterado nesta correção. O Comercial integrado do PR #8, incluindo as correções de preço já presentes em `738c4a2`, foi preservado. Instalador, SSH restrito e script de deploy permanecem idênticos à main. O bootstrap não será reexecutado na VPS existente.

## Merge não aciona deploy

Condição atual do job, preservada nesta correção:

```text
github.ref == 'refs/heads/main' &&
github.event_name == 'workflow_dispatch' &&
inputs.deploy == true
```

| Evento/ref | deploy | Resultado da condição |
|---|---|---|
| push/merge na main | ausente/false | false |
| push na main, mesmo com true hipotético | true | false |
| pull_request | true | false |
| workflow_dispatch na main | false | false |
| workflow_dispatch na main | true | true |
| workflow_dispatch em outra branch | true | false |

O teste usa a expressão do arquivo, sem acionar workflows manuais. `FUNIX_DEPLOY_ENABLED` pode continuar false; a condição atual não depende dela. Merge na main executa CI/publicação GHCR, **sem SSH/deploy**. Dispatch manual autorizado continua usando digests, Environment production, chave restrita e verificação HTTPS já existentes.

## Testes executados

```bash
npm run check
python3 -m unittest discover -s deploy/tests -v
for script in deploy/funix-install deploy/funix-deploy deploy/funix-ssh deploy/test-containers.sh; do bash -n "$script"; done
git diff --check
```

- Build/tipos: aprovados; **50 testes Node aprovados**, sem falhas. Lint sem erros, quatro avisos preexistentes em App.tsx.
- **23 testes Python aprovados**: sete de deploy, dez do instalador e seis de regressão Compose/condição manual.
- Compose real: `config --quiet` e `config --format json` com env sintético em diretório temporário; reprodução da falha anterior e verificação corrigida, sem imprimir configuração/segredos. Negativo `create_host_path: true` recusado.
- Imagem API local construída com `docker --host=unix:///var/run/docker.sock build --target api -t funix-api:pr10 .`; ensaio de persistência entre contêineres aprovado. Nenhum daemon remoto usado.
- Harness desse ensaio: `python3 docs/evidencias/pr10-ci/test-persistence.py`, somente no ambiente local de QA, com acesso ao socket Docker local e permissão para preparar UID 1000 no diretório temporário. Não executar na VPS; não faz parte do instalador ou do deploy.
- As validações completas de imagens web/API e Compose também são executadas pela CI do PR. Consultar os **checks do commit final** e o resultado registrado no [PR #10](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/pull/10); o run antigo com falha não representa a correção.

[Evidências locais](evidencias/pr10-ci/) contêm somente resultados de QA sintético. Não se reexecutou a suíte de navegador, pois não houve alteração funcional/interface; a entrega integrada e suas evidências permanecem no relatório da Issue #7. Health checks em imagem e a suíte Node foram executados nesta branch integrada.

## Pendências objetivas da primeira publicação

Não há defeito de persistência identificado no Compose versionado. Ainda é preciso **instalar esse Compose na VPS** e criar/conferir o diretório persistente com UID 1000 antes de publicar; o Actions troca imagens, não arquivos root do host. Sem isso, o arquivo antigo pode continuar usando configuração inadequada ou o bind novo falhará por diretório ausente.

Não foi conferido o estado efetivo de disco, `/opt/funix/compose.yaml`, credenciais GHCR/SSH, secrets do Environment, DNS/certificado ou contêineres na VPS nesta tarefa. São configurações existentes a conferir na publicação autorizada, não uma exigência de nova infraestrutura. Credenciais Coda não são necessárias para o MVP Comercial. A configuração comercial inicial permanece vazia; a emissão requer os dados fornecidos pelo operador, sem seed fictício.

O [procedimento mínimo](PUBLICACAO_MVP_COMERCIAL.md) preserva senha/configurações existentes, registra Compose/imagens anteriores, prepara somente o diretório FUNIX, substitui o Compose revisado e valida sem imprimir segredos. Depois do merge autorizado, o primeiro deploy é acionado manualmente na main com `deploy=true`. Nenhuma dessas ações foi executada nesta correção.

Backup manual consistente é suficiente para a avaliação inicial; copiar para fora da VPS antes de depender de dados reais. Rollback de imagens não reverte migrações nem apaga SQLite. Não criar staging, subdomínio, novo serviço ou instalação paralela.
