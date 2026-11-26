# Financeiro da Experiência e formas de pagamento

## Referência consultada no Coda

| Área | Informações usadas no ERP anterior |
| --- | --- |
| Título | Direção a receber ou a pagar, contraparte, descrição, valor, vencimento, competência, forma de quitação, classificação, origem, operação, Experiência e fatura. Status e valor liquidado dependem das transações vinculadas. |
| Transação | Valor base, data de caixa, competência, status, meio de liquidação, conta bancária, contraparte, descrição, origem, título, Experiência, regra, classificação e usuário. Os valores de caixa, resultado, liquidação e imposto futuro têm fatores distintos. |
| Regras | Família, código, regra ativa, classificação padrão e fatores de caixa, resultado, liquidação e imposto. Há famílias para recebimento, pagamento, transferência, aporte, retirada, ajuste econômico, ajuste financeiro, retenção e resgate. |
| Forma de pagamento | Pix, dinheiro, boleto, débito, crédito de 1 a 12 parcelas, crédito do cliente, transferência e poupança. A tabela também guarda percentuais pontuais. |

A fórmula do título no Coda soma o valor de liquidação apenas das transações confirmadas. A separação entre obrigação, liquidação e efeito bancário é útil. O preenchimento manual de fatores e a repetição da forma de pagamento em um título inteiro dificultam recebimentos parciais com meios diferentes. Há classificações padrão com referências quebradas e o código AE2 aparece tanto em Garantia quanto em Ajuste Econômico Negativo. Os percentuais registrados para algumas parcelas também não identificam por si só se representam acréscimo comercial, tarifa da operadora ou antecipação.

## Decisões no FunixERP

- Registre a forma em cada recebimento ou pagamento efetivo. A interface pede valor, data e forma. No crédito pede também de 1 a 12 parcelas. Cada baixa parcial pode ter sua própria forma.
- O título futuro continua com valor e vencimento. A forma registrada na quitação descreve o que ocorreu. A migração SQLite V28 preserva baixas antigas como “Forma não informada” e mantém compatibilidade com integrações que ainda omitem o campo.
- Crédito parcelado registra a operação pelo valor bruto pago pelo cliente. A quantidade de parcelas não gera automaticamente créditos bancários, novos títulos, taxas ou impostos.
- Transferência bancária é um meio de pagamento. Transferência entre contas próprias é outro evento financeiro e deverá movimentar as duas contas sem liquidar um título de cliente ou fornecedor.
- Quando for necessário controlar repasse e conciliação, registre conta, valor líquido, tarifas e data de crédito como eventos próprios. Mantenha as regras gerenciais e fiscais explícitas por tipo de evento. Um pagamento por cartão pode quitar o cliente antes de creditar a conta.

Fontes: [ERP FUNIX no Coda](https://docs.superhuman.com/d/Funix_d2zsjI-nqWr), com inspeção de `db_TitulosFinanceiros`, `db_Transacoes`, `Cnf_FormaPagamento`, `cnf_RegrasLancamentos` e `cnf_FamiliaTransacao`.
