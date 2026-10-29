# Matriz Issue #20 — finalização FC/MR

Quantidade 1, FC C0/FR R0 reais, quatro tabelas, sem negociação/componentes. MR Padrão 1.2 é cadastrado, mas não selecionado automaticamente; sua aplicação é validada separadamente no QA. Cada célula indica calculáveis / dimensões testadas.

| Serviço | Padrão | Parceria | Nosso time | Retrabalho | Pendências |
|---|---:|---:|---:|---:|---|
| Alinhamento | 5/5 | 5/5 | 5/5 | 5/5 | — |
| Degradê | 0/4 | 0/4 | 0/4 | 0/4 | Etapas técnicas de serviço/dimensão não configuradas. |
| Descontaminação | 1/1 | 1/1 | 1/1 | 1/1 | — |
| Diagnóstico Técnico | 1/1 | 1/1 | 1/1 | 1/1 | — |
| Ducha | 4/4 | 4/4 | 4/4 | 4/4 | — |
| Elétrica | 3/3 | 3/3 | 3/3 | 3/3 | — |
| Encantamento | 0/1 | 0/1 | 0/1 | 0/1 | FD não configurado. |
| Funilaria | 5/5 | 5/5 | 5/5 | 5/5 | — |
| Inspeção técnica | 0/1 | 0/1 | 0/1 | 0/1 | Preço base não configurado. |
| Interna | 0/3 | 0/3 | 0/3 | 0/3 | Etapas técnicas de serviço/dimensão não configuradas. |
| Lavagem | 4/4 | 4/4 | 4/4 | 4/4 | — |
| Limpeza técnica | 3/3 | 3/3 | 3/3 | 3/3 | — |
| Montagem | 4/4 | 4/4 | 4/4 | 4/4 | — |
| Oxi-sanitização | 0/1 | 0/1 | 0/1 | 0/1 | Etapas técnicas de serviço/dimensão não configuradas. |
| Paintless Dent Removal (PDR) | 4/4 | 4/4 | 4/4 | 4/4 | — |
| Pintura | 4/6 | 4/6 | 4/6 | 4/6 | Etapas técnicas de serviço/dimensão não configuradas. |
| Pintura Roda | 3/4 | 3/4 | 3/4 | 3/4 | Etapas técnicas de serviço/dimensão não configuradas. |
| Plotagem | 3/3 | 3/3 | 3/3 | 3/3 | — |
| Polimento | 0/4 | 0/4 | 0/4 | 0/4 | Etapas técnicas de serviço/dimensão não configuradas. |
| Proteção e cuidado | 0/1 | 0/1 | 0/1 | 0/1 | Etapas técnicas de serviço/dimensão não configuradas. |
| Reforço estrutural | 3/3 | 3/3 | 3/3 | 3/3 | — |
| Reparo | 0/1 | 0/1 | 0/1 | 0/1 | Etapas técnicas de serviço/dimensão não configuradas. |
| Restauração óptica | 0/1 | 0/1 | 0/1 | 0/1 | Etapas técnicas de serviço/dimensão não configuradas. |
| Revitalização de couro | 0/1 | 0/1 | 0/1 | 0/1 | Etapas técnicas de serviço/dimensão não configuradas. |
| Tapeçaria | 0/1 | 0/1 | 0/1 | 0/1 | Etapas técnicas de serviço/dimensão não configuradas. |
| Vidraçaria | 0/1 | 0/1 | 0/1 | 0/1 | Etapas técnicas de serviço/dimensão não configuradas. |
| Vitrificação | 4/5 | 4/5 | 4/5 | 4/5 | Etapas técnicas de serviço/dimensão não configuradas. |

**Total: 204/300 calculáveis; 96 bloqueadas.** Antes desta finalização: 188/300; os 188 casos completos mantêm total/energia/prazo, sem regressões. Os 16 adicionais são quatro dimensões de Lavagem nas quatro tabelas.

Interna e Inspeção técnica têm FC false, mas ainda permanecem bloqueadas por outras pendências. Mecânica não tem dimensão vinculada e não entra nas 300 combinações.

Os 204 casos incluem 51 em Retrabalho com FV=0: calculável não significa receita positiva. Esta matriz não homologa todas as FC/FR, quantidades, negociações ou orçamentos com componentes.

[Matriz completa](matriz.json) · [Dry-run](finalizacao/dry-run-resumo.json) · [Comparação](finalizacao/comparacao.json)
