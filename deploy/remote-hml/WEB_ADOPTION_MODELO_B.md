# HML — reconciliação restrita da imagem Web Modelo B (23/11/2026)

## Evidência observada, não autorização automática

A issue #330 registra publicação Web-only do Modelo B em 22/11/2026, com
`PANEL_DEPLOY_OK`, sem alteração declarada em API, Gateway ou banco. A direção
confirmou posteriormente os IDs Docker instalados pelo comando de inspeção:

| Serviço | ID da imagem em execução |
| --- | --- |
| API | `sha256:53508314296731231f4e2af860f39793ccd8696a91bf4de48163bb2758ac47d0` |
| Web / painel | `sha256:4aae0d21ec1a207285f48cbaea5e1bd1ba889abc9e2053d54079fc90066c521a` |
| Gateway | `sha256:1d4bb63430ffa684179547f9b14656ffe7ccb10d2a7f3776befc1f6b40012c5e` |

O commit `dbfad4be34546497a833fda0c06fc1119332204a` é a referência
do código da PR #333 (Modelo B), **não uma prova criptográfica isolada de
que o container foi construído a partir dessa árvore**. A publicação do
digest Web acima é corroborada pelo histórico operacional da issue #330,
não pelo CI da presente alteração.

## Correção de código e limites

O `rootctl.py` desta revisão permite adotar **somente** a imagem Modelo B
com o predecessor aceito `54b60d98b6c39ff0dc8ada0f7daa60bcf6cf2325`
cuja Web histórica era
`sha256:cc2e9a6b9ef4d8679d1e9830876d32f0cbd065ccf3305ed4e384aba2c1988476`.

Antes de escrever `web-adoption.json`, continua obrigatório:
- estado idle, nenhuma aprovação armada, worker inativo e lock oficial;
- journal de operação aceito; contrato e configuração do atualizador;
- `installed_preflight` com **igualdade de API, Web, Gateway e revisão**
  contra o release fixado, incluindo checks Docker/HTTPS originais;
- HTTPS autenticado do `/painel/` (401 com desafio Basic sem login e 200
  com login), com marcador de conteúdo conhecido;
- vínculo do novo registro ao SHA-256 do journal oficial.

**Evidência posterior de 23/11/2026:** o registro de 573 bytes já presente
em `web-adoption.json` representa a Web `sha256:1399b35c184a48591fab864685b4a82d4fa350d2cc79ea8fd9ff80f9f338b50b`,
com `panel_revision=6ba7797c3ffa14dd192665ae3adef451761d640b`,
`original.web=sha256:cc2e9a6b9ef4d8679d1e9830876d32f0cbd065ccf3305ed4e384aba2c1988476`
e `journal_sha256=be31be39f7e0128347b2faec8cb39395addd5db5ebe52b2be47aae3b2cba1038`.

A nova implementação **não remove nem sobrescreve** esse registro.
Ela cria exclusivamente `web-adoption-model-b.json` no mesmo diretório,
com `schema=funix-hml-web-adoption/2`, hash do journal, original histórico,
`previous_web` e SHA-256 dos bytes do registro anterior.
`control.effective_release` valida a cadeia antes de considerar a
Web Modelo B instalada para preparo, ticket e atualização. Mudanças em
qualquer elo invalidam o estado. O registro da segunda adoção é criado
com O_EXCL e fsync, não com `replace`.

O segundo registro só é autorizado quando o primeiro corresponde à
publicação de fluxograma de 22/11/2026, o preflight integral reconhece
exatamente o Modelo B, e a página autenticada atende ao contrato.
Caso já exista um segundo registro diferente, **bloquear sem sobrescrever**.
Nada aqui aceita digests arbitrários ou mutação implícita da API ou Gateway.

## Próxima janela administrativa (não executada por este commit)

1. Concluir a revisão e CI do SHA **exato** da PR. Conferir o bundle Git
   confiável e a matriz dos 15 destinos antes de qualquer migração.
2. Conferir novamente o inventário físico, journals de migração
   (original `restored`, retry `accepted`, upgrade `accepted`), requests
   pendentes, ausência de holds e permissões, espaço, assinatura mTLS,
   estado de API/Gateway e a integridade de `web-adoption.json` e a ausência/identidade de `web-adoption-model-b.json`.
3. Se a instalação do código for autorizada, usar **apenas o procedimento
   transacional da revisão atual** de `migrate.py`: `inventory-reconcile`
   sobre bundle aprovado, `apply-reconcile`, prova mTLS com origem admissível
   e `accept-reconcile` (ou recuperação/reversão documentada). Não usar
   `install.py` de instalação inicial, `apply-upgrade` histórico, copiar
   arquivos individualmente, nem editar o drop-in do systemd por conta própria.
4. **Somente após** aceite completo da nova versão do controlador e
   verificação dos invariantes, o administrador pode autorizar a operação
   única `rootctl.py adopt-published-panel --authorize`.
5. Conferir `web_adopted`, preservação byte a byte do registro legado,
   vínculo entre os dois registros e journal, novo preflight remoto e estado
   do transporte. `blocked` mantém a operação suspensa até diagnóstico.
   Só depois preparar um candidato HML separado.

Esta PR **não** migra o controlador na VPS, não registra a Web, não faz
merge/deploy de aplicação, não atualiza a API e não toca produção.
