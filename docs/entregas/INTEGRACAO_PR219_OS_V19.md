# PR #219 + OS #221 — integração controlada (V18 → V19)

Estado: **ramificação de integração em desenvolvimento**; não aprovada para merge ou deploy.

## Base de compatibilidade

- Base instalada em `app.funix.com.br`: revisão `9d22ebfff0b4879e706613a1af6baa4839adec6a`, com migração **V18** que cria `work_orders`.
- O administrador da VPS confirmou 1 OS persistida, backend saudável e backup consistente V18 com `integrity_check=ok` e zero violações de FK.
- A PR #219 anterior tinha um **outro** esquema V18 para conversas/clientes. Essa colisão foi removida: o histórico V18 permanece imutável e exclusivo da OS, e `createCustomerSchema` foi movido para **V19**.
- Os arquivos da OS (#221), incluindo repositório, PDF e `BudgetPanel`, foram incorporados a esta integração; a API e a consulta de orçamentos mantêm as rotas da OS.
- `scripts/verify-v19-copy.ts` verifica preservação de todas as tabelas/linhas anteriores, incluindo `work_orders`, entre snapshots consistentes da **mesma origem**.

## Condições necessárias antes de ativar

1. CI e Chromium completos na ramificação integrada; rodar migração **V18→V19 em cópia consistente do banco V18 mais recente**, inclusive conferindo hash/conteúdo da OS persistida e dos PDFs de orçamento.
2. Proteger backup atual V18 também **fora da VPS**; definir restauração coordenada com API parada. Um rollback só de imagem para V18/V17 não recupera banco V19.
3. Testar interface em celular real. Validar separadamente contratos de recepção, proveniência PN/LID, dados da Evolution instalada e roteamento n8n **antes** de habilitar WhatsApp, envio ou mídia.
4. Não confundir configuração `NODE_ENV=production` da imagem com a classificação institucional do ambiente: a VPS atual segue sendo a única instalação de testes.
5. Não houve merge, troca de imagem da VPS, migração do SQLite ativo, configuração de Evolution/n8n ou envio real como parte desta integração.

## Limite da evidência

Os testes anteriores com a PR #219 pura usaram cópias do banco **V17**, antes da OS #221, e **não bastam** para autorizar implantação da nova integração. A migração V18→V19 sobre cópia da instalação após #221 e a validação visual/integrativa continuam pendentes.
