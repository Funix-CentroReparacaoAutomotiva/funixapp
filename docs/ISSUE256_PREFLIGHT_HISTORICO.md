# Issue #256 — preflight histórico, primeira etapa

Contrato interno normalizado schema 1 e validação pura em `server/historical-budget-preflight.ts`. Não é uma API nem autoriza importação. Nenhum dado real.

- Identidade de origem: documento + tabelas + linha física; código de negócio de etapa pode repetir; linha física não. As referências parentais já devem ser resolvidas pelo adaptador Coda, com fonte verificável.
- Valores como strings decimais; preço dos componentes é preço final histórico, sem aplicar MR novamente. O contrato V1 exige valor de serviço bruto, desconto global sobre serviços e total líquido; se o ERP usar representação distinta, o adaptador deve esclarecer o significado, não adivinhar. Quantidades positivas; multiplicação exata precisa fechar em cada linha, sem inventar regra de arredondamento.
- Rateio de etapa: decimal de origem até 18 casas, soma por serviço confrontada com tolerância máxima de meio centavo por etapa, sem modificar valores. Energia confrontada exatamente. Código repetido é aviso, não exclusão de linha. Essa tolerância verifica a soma, não comprova a regra de rateio individual.
- Fatores históricos desconhecidos permanecem null; não promover os parâmetros atuais do Atendimento a dados da versão. Data UTC, prazo registrado, condições ofertadas preservados; não há evidência de pagamento escolhido. Não inclui PDF, cliente ou veículo no contrato parcial.
- Digest SHA-256 do objeto normalizado com ordem fixa de propriedades e linhas físicas; strings decimais preservadas. Não é assinatura, autenticação nem autorização; uma representação decimal diferente gera novo digest.
- Integridade financeira verdadeira é apenas uma etapa, nunca liberação para gravar. Próximas etapas: adaptador read-only da fonte, confirmação de vínculos e catálogo, comparação do motor atual, persistência histórica separada e transacional, API autenticada, UI/QA. Não foi criada rota, migração ou alteração no fluxo normal de emissão.
- Testes sintéticos em server/tests/historical-budget-preflight.test.ts; aguardar evidência do CI Node 24 do PR antes de considerar validado.
