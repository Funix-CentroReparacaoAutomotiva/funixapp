# Issue #70 — busca manual gratuita no Diagnóstico

**Decisão da direção em 08/11/2026:** substituir o fluxo de pesquisa paga do Diagnóstico por três links externos, na ordem **Geral | Original | Loja oficial**. Manter o ícone após MR. Os três atalhos só aparecem quando o componente **e a peça-pai** estiverem selecionados no cenário. Não reabrir após desmarcar/remarcar sem clique. O preço continua manual.

## Implementação proposta
- `src/DiagnosisComponentQuote.tsx`: menu aberto apenas sob clique, com links externos `noopener noreferrer`, sem `POST /cotar`, API OpenAI ou seleção de valor.
- `src/diagnosis-search-links.ts`: montar a pesquisa com marca, modelo, ano inequívoco e componente, jamais com PII/placa/telefone/notas. `Geral` usa Google Shopping; `Original` acrescenta a palavra `original`; `Loja oficial` segue mapa restrito de URLs de canais conhecidos. Não inventar URL de busca interna na loja.
- `src/DiagnosisEditor.tsx`: usar `piece.enabled && component.enabled`, estados já existentes, para habilitar o botão e esconder as opções. Nenhum segundo seletor.
- CSS responsivo e smoke Chromium sintético a 320/390/1440, sem pesquisa externa.
- No caso de marca sem canal oficial mapeado, `Loja oficial` aparece indisponível. Busca Google continua possível.
- Se faltar marca/modelo ou descrição segura, não montar URLs externas.
- Nenhum anúncio ou preço é qualificado como genuíno/compatível pelo aplicativo: atalhos são apenas pesquisas.

## Segurança e escopo
Não há alteração no motor de orçamento, MR, campos financeiros, banco, Copiloto, ledger ou VPS. Os endpoints antigos de cotação permanecem na base nesta PR, mas o **Diagnóstico não os chama**. Para desligar o piloto pago também no runtime, o operador deve conduzir mudança controlada das flags em etapa posterior, especialmente `FUNIX_DIAGNOSIS_QUOTE_ENABLED=false`, sem tocar no ledger existente (último registro 3/10). Não acionar deploy e não consumir reservas.

**Validações antes de merge:** `npm run check` e Chromium; conferir abertura de links, domínio permitido, ordem, item desmarcado, pai desmarcado, reativação, ausência de requisições `/cotar`, ausência de overflow e dados pessoais em URLs. Somente após revisão e autorização expressa da direção fazer merge/deploy.
