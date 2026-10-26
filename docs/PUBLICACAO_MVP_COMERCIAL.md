# Publicação do primeiro MVP Comercial no endereço atual

**Alvo único:** https://app.funix.com.br (sem hostname, contêineres ou ambientes adicionais).

## Estado e limites

Esta PR de integração une **as duas linhas do GitHub sem descartar o instalador**: a imagem/código do Comercial partem do PR #8; os scripts `deploy/funix-install`, testes de instalação, documentação da instalação e workflow principal são preservados da `main`. O Compose incorpora o ajuste de tmpfs do PR #5 e adiciona um armazenamento local gravável para SQLite. A PR não faz deploy nem alteração na VPS.

**Antes do merge na main:** verificar CI verde da PR e histórico de merge; `publish` apenas envia imagens ao GHCR. A condição de deploy neste workflow foi **reduzida a `workflow_dispatch` com `deploy:true`**; push/merge não deve acionar deploy automaticamente, independente de uma variável antiga.

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
