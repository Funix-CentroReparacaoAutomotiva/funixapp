# Issue #256 — Conciliação Cilia (incremento 4)

A especificação v0.3 prioriza método/escopo técnico equivalente, menor soma dos desvios absolutos dos valores dos grupos e, no empate, menor desconto global elegível. O planejador Coda anterior minimiza o desconto; seu comportamento permanece inalterado.

O módulo `cilia-reconciliation.ts` lista dimensões ativas vinculadas ao serviço (não são opções tecnicamente aprovadas), e escolhe, entre opções já revisadas e precificadas pelo motor, a combinação que respeita o total-alvo e a elegibilidade de desconto. A busca tem limites, usa aritmética racional existente, poda por limites otimistas e não retorna combinação parcial quando o limite é atingido. Não altera preço, quantidade, energia, catálogo ou desconto diretamente no banco. Não infere intensidade de horas nem aprova automaticamente dimensão.

A seleção específica é chamada pelo planejador neutro somente para Cilia, no perfil sem desconto na origem, com opções explícitas. O cálculo e a conferência integral de totais já existentes continuam obrigatórios. Desconto na origem exige revisão. Os testes sintéticos do planejador existente exercitam a nova rota lógica, inclusive bloqueio de desconto na origem.

**Limites:** o planejador atual ainda exige relações 1:1, rejeita componentes de terceiros, sobreposição e serviços sujeitos à confirmação externa. A origem XML e os candidatos ainda não estão conectados ao planejador, e uma tela/API de prévia nativa ainda não foi implementada. O módulo não autoriza gravação. Faltam contrato de agrupamento explícito, fornecimento sem faturamento, revisão de serviços especiais, identidade e versões. Não remover bloqueios para simular êxito. Sem merge, deploy ou dados reais no Git.

**Validação local do módulo isolado:** Node 22.16.0 e TypeScript 5.8.3, com `exact.ts` de hash idêntico ao repositório. Cinco testes sintéticos, verificação estrita de tipos do módulo e comparação com busca exaustiva em 500 casos sintéticos aprovados. O checkout completo não está disponível; os testes integrados e o CI Node 24/TypeScript 6 continuam necessários. Não se presume homologação.
