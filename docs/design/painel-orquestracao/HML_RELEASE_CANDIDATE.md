# FUNIX — Candidato de publicação do Painel na HML

**Estado:** candidato de revisão, não implantado. PR #322 (draft), branch `release/301-painel-hml-candidate`.

## Objetivo restrito

Disponibilizar o painel somente leitura em `https://hml.funix.com.br/painel/`, preservando proteção Basic Auth do gateway e isolando os recursos na imagem Web da homologação. A imagem Web normal permanece sem o painel.

## Dependências verificáveis

- As PRs de origem são #318 (painel dinâmico com agrupamento por projeto) e #320 (variante `web-hml-painel`). Não precisam ser mescladas previamente para revisar este candidato, mas a governança deve definir o fechamento posterior dessas PRs.
- A PR #321 prepara no fluxo oficial de candidato a opção explícita `web-hml-painel`. Sem essa mudança integrada e revisada em `main`, o workflow antigo construiria a Web **sem painel**.
- O seletor oficial exige uma PR aberta para `main` e todos os workflows obrigatórios concluídos no SHA exato, associados a essa PR.
- O workflow oficial constrói artefato **API + Web HML**, não um pacote autônomo apenas de HTML. Antes de transferir à VPS, comprovar compatibilidade da API candidata com o banco e a release atualmente instalada. O gateway deve permanecer fixado conforme contrato aprovado.
- Inspecionar no host o procedimento de atualização, locks, journals, imagem instalada, hash do gateway, integridade/backup SQLite, período de manutenção e rollback. Testes sintéticos CI não substituem essa inspeção.
- Validar antes e depois os seis caminhos de `/painel/` exigindo `401` e desafio Basic sem credenciais. Após implantação autorizada, validar `200` com credenciais fornecidas somente no ambiente do operador.
- Fonte pública: `snapshot.json` não pode conter segredos nem informações de clientes. Alterações futuras do snapshot requerem release HML controlada.

## Política de execução

**Não realizar merge, deploy, disparo de atualização n8n, SSH de escrita, edição da VPS ou alteração de produção automaticamente.** O candidato é um registro técnico para revisão, CI e decisão administrativa posterior.

## Evidências anteriores

A PR #320 passou em quatro workflows no HEAD anterior, incluindo teste de imagem HML e preflight HTTP sem credenciais; a nova PR deve concluir a própria matriz de testes. Diagnóstico administrativo somente leitura de 22/11/2026 confirmou API/Web e gateway saudáveis, mas não verificou banco ou aptidão de atualização real.

## Aceite da direção

Implantação somente após: aprovação técnica independente; CI exato; pacote candidato emitido pelo fluxo confiável; preflight operacional local com contrato/identidade/backup/rollback; autorização operacional específica. Não confundir sucesso de build com liberação da instalação.
