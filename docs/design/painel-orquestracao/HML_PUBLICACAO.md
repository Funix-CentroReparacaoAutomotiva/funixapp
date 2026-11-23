# FUNIX — Painel de Orquestração em `/painel/` da HML

**Estado histórico e atual:** a versão inicial do painel foi implantada manualmente na Web da HML em 22/11/2026, com evidência `PANEL_DEPLOY_OK` registrada na issue #301; a arquitetura descrita abaixo foi originalmente preparada antes daquela implantação. **A atualização sob demanda da branch `painel-publicado` ainda é desenvolvimento e não está implantada.** Nenhuma alteração nesta documentação autoriza novo merge/deploy, DNS, gateway, Traefik ou API.

## Decisão de desenho

A direção escolheu como destino provisório `https://hml.funix.com.br/painel/`, preservando o mesmo login do gateway HML. Para não acrescentar serviços, redes, volumes ou middleware no gateway, a imagem Web **exclusiva da HML** recebe apenas cinco arquivos estáticos do painel. A imagem Web usada pela produção (`--target web`) não inclui esses arquivos.

A topologia instalada continua com `api`, `web`, `gateway` e os mounts atuais; o gateway HML e o Traefik permanecem inalterados. A variante `web-hml-painel` herda o estágio `web` e acrescenta arquivos em `/usr/share/nginx/html/painel/`. A HML candidata deve construir **somente sua imagem Web** usando esse alvo. A API e os contratos de release permanecem os mesmos. O painel é somente leitura; seu JSON continua sendo versionado, e não há token nem automação de agentes.

## Condições **antes** de qualquer deploy

1. Conferir por inspeção **somente leitura** a configuração realmente instalada de gateway e os resultados do contrato de isolamento. A existência do gateway no repositório não comprova que o caminho `/painel/` esteja autenticado. Não modificar seus dois bind mounts nem o hash aprovado do `gateway.compose.yaml` para contornar uma falha.
2. Executar o preflight HTTP externo **sem credenciais** de todos os caminhos: `python3 deploy/painel-hml-acceptance.py --mode preflight`. **Cada rota deve responder 401 com desafio Basic**. Se houver `200`, `3xx`, `404`, `403` ou outra resposta, bloquear publicação e investigar — não abrir um roteador no Traefik que bypassaria a autenticação.
3. Verificar que não existe uma rota conflitante `/painel/`, que não serão expostos arquivos confidenciais e que `snapshot.json` contém exclusivamente os registros públicos aprovados. O endereço não constitui área privada de dados: o repositório e o histórico referenciado são públicos.
4. Conferir CI do **SHA exato** da PR, revisão independente de Dockerfile/workflow/snapshot, compatibilidade da candidata HML com o atualizador oficial e autorização administrativa específica para implantação da HML. Não atualizar HML se houver outra operação pendente, lock, recuperação ou manutenção.

## Testes disponíveis (sem VPS)

- `python3 -m unittest discover -s deploy/tests -p 'test_painel_hml_acceptance.py' -v` verifica o contrato de aceite e a rejeição a rota pública/redirect.
- `.github/workflows/painel-hml-build.yml` constrói separadamente `web` e `web-hml-painel`, confirma que produção não contém o painel e faz GET HTTP real contra Nginx da variante HML, sem publicação de portas.
- `deploy/test-painel-hml.sh` valida localmente `/painel/`, HTML, CSS, JS e JSON dentro da variante HML; **não prova autenticação do gateway instalado**.
- `deploy/painel-hml-acceptance.py --mode preflight` consulta o host real **somente leitura**; não utiliza credenciais nem altera sistemas.

## Aceite após eventual deploy autorizado

1. Executar `FUNIX_HML_BASIC_USER` e `FUNIX_HML_BASIC_PASSWORD` no ambiente **local do administrador**, sem compartilhar credenciais no chat, passar em argumentos, salvar em CI ou gravar em arquivos públicos.
2. Rodar `python3 deploy/painel-hml-acceptance.py --mode accept`. Cada rota deve devolver **401 sem credenciais** e **200 com credenciais**, com o conteúdo esperado. Nenhum redirect é seguido.
3. Verificar `https://hml.funix.com.br/painel/` em celular real; verificar visualmente frentes, histórico, atualização do JSON e estado não verificado quando a API externa falhar.
4. Confirmar que a HML existente mantém autenticação, API, Web, gateway e revisões coerentes, sem afetar `app.funix.com.br` ou demais serviços. Registrar release e possibilidade de rollback conforme o processo oficial HML.

## Atualizações e rollback

O mapa do CTO é compilado na variante Web HML por SHA. A alteração de `snapshot.json` no GitHub **não modifica instantaneamente a HML**: requer o fluxo HML de atualização autorizado e validado. Não prometer atualização automática online nesse desenho. Histórico público no GitHub pode ser consultado dinamicamente pelo navegador, sujeito a limites da API.

Para retirar a prévia: implantar novamente **uma imagem Web HML aprovada sem o painel** pelo procedimento oficial de release/rollback, sem alterar gateway, Docker, bancos ou infraestrutura compartilhada manualmente. Um rollback de imagem pode ser arriscado quando há migrações do ERP; avaliar compatibilidade e backup antes de qualquer operação real.

Se a proteção de `/painel/` não existir na configuração instalada, **este plano deve ser revisado**; não fazer deploy somente porque o contêiner de testes respondeu 200.
