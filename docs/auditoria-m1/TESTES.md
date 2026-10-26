# Testes e proveniência das evidências

Na preparação da auditoria, foram executados sobre o código existente, sem alterar funcionalidades:

| Comando | Resultado e evidência |
|---|---|
| `npm run check` | Exit 0; build Vite, tipagem frontend/backend, suíte Node e lint. Saída integral: `logs/npm-run-check.log`. Quatro avisos de efeitos React, sem erros de lint |
| `python3 -m unittest discover -s deploy/tests -v` | Exit 0; 7 testes. Saída integral: `logs/deploy-tests.log`. Docker simulado, nenhum comando na VPS |
| `python tests/browser/m1_atendimentos.py` | Exit 0; 19 grupos de cenários. Saída integral: `logs/browser-tests.log`; relatório `../evidencias/m1-browser-resultados.json` |
| `git diff --check` | Exit 0 no diff de arquivos já rastreados, antes do staging |
| `git diff --cached --check` | Após incluir todos os novos, detectou whitespace nos originais recebidos; saída em `logs/staged-diff-check.log` e código em `logs/staged-diff-check.exit`. Preservados literalmente para manter seus hashes; não foi corrigido conteúdo de referência |
| `git diff --cached --check -- . ':!docs/especificacao-v1.0/originais'` | Exit 0: sem erros de whitespace fora dos originais; `logs/code-diff-check.log` |

Node local v24.19.0 e npm 11.9.0. O navegador foi executado com permissão ampliada para Chromium/processos/portas locais neste sandbox, sem conceder acesso à VPS. O runner cria banco temporário próprio e senha aleatória, inicia e encerra seus próprios processos, testa reinício da API e novo navegador e remove o arquivo temporário ao sair. Nenhum registro é criado no banco normal. Não há requisições externas do navegador no relatório.

O teste de reinício Node usa dois processos independentes e relatórios temporários, sem depender de stdout de filhos. A suíte de browser usa o backend e o SQLite reais; as únicas injeções são um PATCH 503 e um GET atrasado para testar falha/race. O conflito 409 é gerado por revisão real do banco.

As construções e smoke tests Docker citados em `M1_ATENDIMENTOS.md` pertencem à validação anterior da entrega. **Não foram reexecutados nesta preparação e sua saída bruta anterior não foi preservada.** Os comandos usados naquela validação foram, com Docker local e CA do ambiente no build web:

```bash
docker --host=unix:///var/run/docker.sock build --target api -t funix-api:ci .
docker --host=unix:///var/run/docker.sock build --secret id=proxy_ca,src=/etc/ssl/certs/ca-certificates.crt --target web --build-arg APP_REVISION=development -t funix-web:ci .
bash deploy/test-containers.sh
```

Esses smoke tests usam contêineres locais descartáveis sem rede externa e SQLite em `/tmp`; não certificam volume ou durabilidade na VPS. Não houve nova execução do GitHub Actions, pois nenhum push foi feito.

Os screenshots foram regenerados pelo teste de navegador desta auditoria. Contêm nomes/placas explicitamente de QA e telefone mínimo sintético, sem informações de clientes. Os logs omitem a senha aleatória; senhas literais de fixtures nos fontes são apenas valores sintéticos dos testes.
