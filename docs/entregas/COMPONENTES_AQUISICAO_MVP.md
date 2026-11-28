# Componentes externos — MVP de aquisição e disponibilidade

Base: `codex/erp-operacional`, 48d4a9024ec852e2a327b45cdf3b4e5cc7a75628 (PR #370). Incremento independente, sem deploy.

## Contrato

- Somente linhas `kind=component` incluídas no escopo congelado da OR selecionada/vinculada à Experiência e da OS. Não criar necessidades a partir de serviços, desmontagem ou peças do próprio veículo. Alternativas comerciais ainda não vinculadas ficam fora da aquisição.
- Identificação é derivada da OR emitida e consentida no vínculo existente; a data inicial é a emissão. A OS usa exatamente o agrupamento/numeração do PDF (A1, A2 etc.), sem chave por nome ou placa. Antes de emitir OS, o código é previsto e a interface identifica a OR.
- Aquisição: Identificado → Solicitado → Aprovado → Recebido; origem é separada (FUNIX, cliente, seguradora, associação, estoque próprio, outro). Uma chegada real pode ser lançada diretamente, sem simular eventos intermediários.
- Situação física independente: Armazenado ao confirmar a chegada; Saiu ao registrar a saída; retorno manual possível. Saída do veículo não retira automaticamente nenhum componente. Não classificar instalação, venda, perda ou destino; não controlar posição física interna.
- Um registro por versão de OR/linha congelada, compartilhado entre Comercial (Experiência), Oficina (Pátio/consulta) e Estoque (Componentes). Histórico append-only, revisão de concorrência, datas de aquisição e custódia distintas. Aquisição cancelada com acompanhamento já iniciado continua visível, inclusive para registrar uma chegada tardia.
- MVP manual: atualizar origem/status e confirmar; atalho de recebimento quando origem já definida; no Estoque, filtros por status, situação física e busca por placa, OS ou nome/código. Recebimento confirma quantidade integral da linha. Fracionamento de quantidade, foto/anexos, OCR, Drive, compras automáticas, movimentações por localização e identificação nominal do operador fora deste incremento (sessão atualmente compartilhada). Não presumir recebimentos históricos.
- V33 exclusivamente aditiva e transacional, preserva escopos, PDFs e os registros existentes. Não importar dados reais.

## Validação

- `npm run check`
- `node --test server/tests/erp-acquisition.test.ts server/tests/os-jsreport.test.ts`
- `python tests/browser/erp_acquisition.py` em ambiente com Chromium e Playwright; teste de aquisição/saída nas três visões e resolução 320/390/1366 px.
- Sem autorização de merge ou implantação.
