# Publicação do primeiro MVP Comercial no endereço atual

**Alvo único:** https://app.funix.com.br (sem hostname, contêineres ou ambientes adicionais).

## Estado e limites

Esta PR de integração une **as duas linhas do GitHub sem descartar o instalador**: a imagem/código do Comercial partem do PR #8; os scripts `deploy/funix-install`, testes de instalação, documentação da instalação e workflow principal são preservados da `main`. O Compose incorpora o ajuste de tmpfs do PR #5 e adiciona um armazenamento local gravável para SQLite. A PR não faz deploy nem alteração na VPS.

**Antes do merge na main:** verificar CI verde da PR e histórico de merge; `publish` apenas envia imagens ao GHCR. A condição de deploy neste workflow foi **reduzida a `workflow_dispatch` com `deploy:true`**; push/merge não deve acionar deploy automaticamente, independente de uma variável antiga.

`FUNIX_DEPLOY_ENABLED` pode permanecer `false`: o job atual não usa essa variável para autorizar push, nem para bloquear a primeira execução manual. A execução manual exige `main` e o booleano `deploy=true`, além das proteções do Environment `production`. Não executar o workflow durante a revisão deste PR.

## Preparação única da VPS — antes da primeira publicação comercial

Usar console administrativo privado na Hostinger. Os comandos abaixo **são exemplos para execução mediante autorização específica**, não fazem parte desta PR/CI.

1. Conferir que os serviços atuais `funixapp-api-1` e `funixapp-web-1` estão saudáveis e salvar versão/Compose atuais. Não operar serviços de terceiros, n8n, Evolution API, Traefik, DNS ou firewall.
2. Conferir capacidade básica de disco e RAM. Confirmar o usuário Node da imagem API (UID 1000), o caminho `/var/lib/funix` existente e a versão Docker Compose.
3. Criar o diretório persistente **somente para FUNIX** com `sudo install -d -o 1000 -g 1000 -m 0700 /var/lib/funix/app-data`. Não usar `/tmp` para o banco do MVP.
4. Fazer cópia de segurança do `/opt/funix/compose.yaml` atual (root-owned, não dentro do checkout). Substituí-lo **de maneira controlada** pelo `compose.yaml` revisto, mantendo root:root e permissão restrita. Não modificar `/etc/funix/runtime.env`: a senha do operador existente continua válida; **não publicar segredos no GitHub ou neste chat**. O `FUNIX_DATABASE_PATH` é definido pelo Compose, não precisa incluir no env.
5. Validar `docker compose --project-name funixapp -f /opt/funix/compose.yaml ... config --quiet` com variáveis de imagem/release existentes (sem exibir segredos). Verificar que a montagem bind `/var/lib/funix/app-data:/data` é exclusiva da API e que `tmpfs /tmp` permanece em web e API.
6. Testar permissão de escrita de UID 1000 no diretório, preferencialmente com comando inofensivo que não afete contêineres existentes.
7. Depois do merge revisado, aguardar as imagens por digest do GHCR e **acionar manualmente** a execução de workflow da `main` com deploy true. O deploy gerenciado existente atualiza **somente** os dois serviços FUNIX. Testar `/api/ready`, `/release.json` com o mesmo SHA, sessão e um Atendimento sintético.
8. O banco inicial do MVP é novo: os Atendimentos da API Coda antiga não são importados. Se houver dados novos já salvos no caminho escolhido, **não sobrescrever nem iniciar antes de revisar**.

### Comandos mínimos para a VPS já preparada — somente após autorização

Executar a partir de um checkout conferido do **commit integrado aprovado**, no console administrativo. Não executar novamente `deploy/funix-install`: o bootstrap existente e o SSH restrito permanecem instalados. Não é necessário instalar Node na VPS, criar outro banco, ambiente ou subdomínio.

```bash
git rev-parse HEAD
# Conferir o SHA aprovado antes de continuar.
sudo test ! -L /var/lib/funix/app-data
# Se o diretório já contiver dados, preservá-los e conferir antes de continuar.
sudo cp -p /opt/funix/compose.yaml "/opt/funix/compose.yaml.pre-mvp-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -o 1000 -g 1000 -m 0700 /var/lib/funix/app-data
sudo install -o root -g root -m 0644 compose.yaml /opt/funix/compose.yaml
sudo docker --host=unix:///var/run/docker.sock compose \
  --project-name funixapp --file /opt/funix/compose.yaml \
  --env-file /var/lib/funix/current.env config --quiet
```

`current.env` é o estado de release do instalador/deploy existente, contendo somente revisão e referências das imagens. Se ainda não houver uma release registrada, usar um arquivo de release conferido com `FUNIX_RELEASE`, `FUNIX_API_IMAGE` e `FUNIX_WEB_IMAGE` por digest, sem senha. Não imprimir o Compose expandido, pois ele inclui `/etc/funix/runtime.env`.

O bind é `/var/lib/funix/app-data` no host → `/data` na API; `FUNIX_DATABASE_PATH=/data/funix.sqlite`. O banco e journals ficam nesse diretório, fora da camada do contêiner e do tmpfs `/tmp`. A API roda como UID/GID 1000 e cria o arquivo 0600. `create_host_path: false` recusa diretório ausente em vez de criá-lo silenciosamente como root. A recriação de API/web não remove o diretório do host.

Somente depois dessas conferências e da autorização de publicação, abrir **Actions → FUNIX CI and delivery → Run workflow → branch main → deploy=true**. O job publica as imagens e envia seus digests ao comando SSH restrito. **O Actions não instala o Compose:** a substituição manual acima precisa ocorrer antes. Manter a senha, credenciais GHCR, chave SSH/known_hosts e rede existentes. Nenhuma nova credencial Coda é necessária.

Conferir `/api/ready` e `/release.json` com o mesmo SHA, login e um Atendimento sintético. A preparação acima só valida arquivos; não inicia nem atualiza contêineres. Se houver falha de credencial/saúde na publicação autorizada, revisar os logs protegidos locais, sem colar segredos. Não mudar DNS/Traefik preventivamente.

## Conferência técnica do PR #10

A falha do run `40260342074` era uma expectativa incorreta da verificação Python, não um defeito do bind: `docker compose config --format json` omite `create_host_path` quando `false`. A comparação anterior tratava a ausência como `None`, falhando. A correção aceita ausência/`false` e continua recusando `true`, caminho temporário e serviços de terceiros. O Compose de produção permaneceu inalterado nesta correção.

Testes de regressão executam a própria expressão de validação do workflow, além da condição de deploy para push/PR/dispatch. O teste local com API em produção, rede desabilitada, UID 1000 e diretório sintético recuperou Atendimento/cenário depois de **remover e recriar** o contêiner. [Resultados e limites](PR10_CORRECAO_CI.md).

## Recuperação e cópia de segurança proporcionais

- Antes da troca, registrar imagem e Compose anteriores; rollback da imagem **não desfaz** migrações SQLite.
- Para o MVP inicial, o novo SQLite nasce vazio e não requer conversão de dados da API legada. Se precisar retornar à interface antiga, restaurar imagens e, se necessário, Compose anterior. **Preservar o diretório SQLite**; não o apagar em rollback.
- Após começar a criar dados que deseja manter, gerar backup consistente com o script `server/backup.ts` (API Node `backup()`), dar a cópia a um diretório fora de `/var/lib/funix/app-data` e ensaiar restauração em arquivo separado. Não copiar banco ativo diretamente com `cp`.
- No estágio de avaliação, backup manual antes de atualizações e nenhum novo serviço de backup são suficientes. Antes de usar dados reais de clientes, combinar uma rotina simples de cópias externas à VPS.

## Critérios da primeira avaliação

- App disponível no mesmo domínio em celular e computador, com login.
- Criar Atendimento, cadastrar peças e serviços, comparar duas prévias, calcular, emitir PDF, recarregar e recuperar versão emitida após reinício.
- Nenhum dado de teste enviado ao Coda/WhatsApp/IA.
- Catálogos reais, apresentação das frações de centavo e identidade final do orçamento continuam sujeitos à conferência do proprietário.
- Não confundir **MVP disponível para teste** com liberação para operação comercial real.
