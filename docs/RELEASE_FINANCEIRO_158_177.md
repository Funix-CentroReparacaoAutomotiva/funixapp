# FUNIX — Candidata financeira #158 + #177 | homologação e deploy manual

## Escopo exato
Esta candidata reúne a PR #186 (#158, eliminar segunda confirmação do terceiro) e a PR #193 (#177, mínimo comercial de cinco dias úteis quando Pintura canônica está efetivamente incluída). **Não** incorpora as PRs #133 (#121, persistência V15) nem #135 (#123, PDF mobile), que continuam abertas para revisão independente. Não altera tabelas, migrações, taxas ou valores já emitidos.

## Ambiente existente
Reutilizar **https://app.funix.com.br** e o projeto Compose FUNIX instalados. Não criar ambiente, hostname, volume ou banco adicional. A política de deploy vigente está em `docs/PUBLICACAO_MVP_COMERCIAL.md` e `.github/workflows/funix.yml`. O workflow já tem botão manual: `Actions → FUNIX CI and delivery → Run workflow → main → deploy=true`. Somente a `main` publica imagens; PR não gera release implantável.

## Controle de liberação
1. Conferir nesta PR integrada CI/Chromium/PDF **todos verdes**, testes de backend e síntese de contêineres.
2. Reconfirmar `main` atual e possíveis conflitos com PRs paralelas. Revisar o diff desta candidata contra `main`; não incorporar mudanças de Coda, WhatsApp, editor ou PRs de QA marcadas NÃO INTEGRAR.
3. Homologar explicitamente a política do **prazo manual**: valor menor que cinco dias é preservado no rascunho, mas o prazo emitido passa a cinco dias úteis com aviso. A inclusão de Pintura é determinada por ID de serviço `i-XDTMBmueos`, não por nomes/etapas.
4. Conferir que instalação atual já tem Compose persistente, API/web saudáveis, configuração do jsreport e permissões/segredos do workflow. Não copiar segredos para GitHub/PR ou chat.
5. Confirmar que não há migração de schema nessa candidata e que **outros merges na main**, especialmente #121/V15, não foram introduzidos sem plano de backup. Se houver migração, interromper este roteiro e aplicar procedimento de backup/restauração conjunto documentado em `docs/ISSUE121_SEGURANCA_MIGRACAO_V15.md`.
6. Após revisão e autorização de integração, realizar merge da PR de release para `main`. Isso publica imagens no GHCR, **sem deploy automático**.
7. Confirmar que o `publish` do commit integrado concluiu e que o Environment `production` está corretamente configurado. Em `Actions → FUNIX CI and delivery → Run workflow`, selecionar **branch main**, **deploy=true**, e executar manualmente. O próprio workflow valida a revisão em `/api/ready` e `/release.json`.
8. Após deploy, testar login, abertura de Atendimento sintético, orçamento com e sem Pintura, prazo manual 3 dias com Pintura (prazo efetivo 5), troca de cenário, prévia sem emissão, PDF novo sintético apenas se autorizado e leitura de PDF histórico sem regeneração. Conferir flags, total financeiro e sem novas reservas ao visualizar prévia.
9. Em falha, pausar novas execuções. Se **não houve migração**, usar apenas o rollback autorizado das imagens FUNIX, conforme `deploy/funix-deploy`. Se houve migração, não fazer rollback isolado de imagens.

## Condições de parada
CI falho, `main` alterada sem reconciliação, configuração do jsreport ausente, ambiente já com dados/schema incompatíveis, dúvida sobre banco persistente, backup insuficiente ou divergência de prazo entre UI/snapshot/PDF. Nessas situações, não executar o job manual.

## Restrições
Este roteiro não autoriza outras alterações: não executar atividades no Coda/WhatsApp, não reemitir documentos reais nem mudar taxas globais. A instalação e o deploy operacional são ações separadas do preparo desta candidata.
