# FUNIX — Contrato de integração do template de Ordem de Serviço

> **Estado:** referência técnica preparatória, não aprovação do layout nem implementação jsreport.  
> **Origem:** PR #221 (`feat/orcamento-emitido-criar-os`).  
> **Escopo:** imprimir e reimprimir uma OS **persistida** a partir de uma versão efetivamente emitida de orçamento.

## 1. Fonte de dados e responsabilidade

O template deve receber um objeto `WorkOrder` já persistido, **sem consultar o cenário editável nem recalcular o orçamento**.

- Tipo canônico: `shared/work-order.ts`.
- Persistência e filtro de serviços: `server/work-orders.ts`.
- Contrato HTTP autenticado: `GET /api/atendimentos/:atendimentoId/orcamentos/:versionId/os`.
- PDF provisório: `GET /api/atendimentos/:atendimentoId/orcamentos/:versionId/os/pdf`, gerado por `server/work-order-pdf.ts` e `server/pdf.ts`.
- Fluxo do usuário: `src/BudgetPanel.tsx`, com **Criar OS** (após confirmação) e **Ver OS / Imprimir**.
- A UI não deve invocar a emissão comercial nem pedir ao template que grave, autorize, recalcule ou altere uma OS.

## 2. Campos disponíveis no objeto operacional

```ts
type WorkOrder = {
  id: string;                 // identificador técnico
  number: string;             // ex.: OS-000001
  atendimentoId: string;
  budgetVersionId: string;    // versão emitida imutável
  budgetNumber: string;       // número do orçamento de origem; pode estar vazio
  budgetLabel: string;
  createdAt: string;          // ISO UTC: formatar para America/Sao_Paulo
  authorization: {
    confirmedAt: string;      // confirmação declarada na sessão
    source: 'authenticated-session-confirmation';
    operatorId: null;         // sessão não identifica operador individual
  };
  scope: {
    customer: { name: string };
    vehicle: { description: string; plate: string };
    diagnostics: Array<{
      pieceId: string;
      pieceName: string;
      diagnosis: string;
      intensity: string | null;
      notes: string;
    }>;
    lines: Array<{
      id: string;
      pieceId: string;
      kind: 'service' | 'component';
      pieceName: string;
      name: string;
      diagnosis: string;
      dimension: string;
      quantity: string;       // texto decimal original
      notes: string;
      stages: Array<{ name: string; dimension: string }>;
    }>;
    deadlineDays: number | null; // previsão em dias úteis, NÃO data de entrega
  };
};
```

**Atenção:** as listas `diagnostics` e `lines` não têm garantia de correspondência de 1 para 1. O template pode agrupar `lines` por `pieceId`, mas não deve presumir que toda linha tenha todas as dimensões, observações ou etapas. `kind='component'` é um componente, não um serviço técnico. Todos os `lines` presentes já passaram pelo filtro `included === true` do orçamento emitido.

## 3. Limites do conteúdo impresso

1. Documento operacional de **execução**, não proposta comercial.
2. **Proibido** imprimir preços, descontos, margens, taxas de parcelamento, energia ou parâmetros do motor de preço.
3. **Não inventar** placa, descrição, diagnóstico, prazo, etapas ou responsável quando ausentes.
4. Não transformar `deadlineDays` em uma data confirmada de entrega.
5. A confirmação interna de autorização **não comprova, por si, aprovação externa do cliente**. A identificação individual de operador ainda não existe.
6. Preservar a origem do orçamento (`budgetVersionId`, `budgetNumber` quando disponível) e o número da OS.
7. Não misturar serviços não autorizados ou versões de orçamento diferentes.
8. Exibir textos acentuados corretamente e suportar observações longas, muitas peças e mais de uma página A4, com cabeçalhos/rodapés adequados.

## 4. Comparação dos modelos HTML A/B (pendente de recebimento)

Os modelos HTML desenvolvidos em paralelo **ainda não foram anexados a esta PR**. Não se presume sua aprovação ou escolha.

Avaliar ambos com o **mesmo** `WorkOrder` sintético, preferencialmente incluindo várias peças, dois serviços na mesma peça, ao menos uma etapa por serviço, um componente, observação longa e campos opcionais vazios. Escolher pela legibilidade durante a execução, menor risco de confundir etapas com serviços, aproveitamento da folha e economia de tinta; não por ornamentação.

| Critério | O que comprovar |
| --- | --- |
| Correspondência | Todas as linhas autorizadas, sem duplicação ou omissão |
| Hierarquia | Peça/diagnóstico, serviço/componente, etapas e observações distinguíveis |
| Segurança | Nenhum campo financeiro, autorização ou prazo inventados |
| Impressão | A4, quebra de página, textos longos, cabeçalho/rodapé e contraste |
| Uso | Navegação e acionamento de impressão no desktop e celular |
| Manutenção | Renderizador substituível sem mudar a tabela de OS nem o orçamento emitido |

## 5. Integração futura (somente após a escolha)

- **Não trocar só o arquivo no jsreport:** a OS atual **não usa jsreport**. Será necessário implementar e testar um adaptador que transforme `WorkOrder` em dados do HTML e renderize o PDF escolhido, preservando a rota de consulta.
- A decisão entre jsreport e HTML/browser print depende dos modelos aprovados, fontes disponíveis, qualidade de impressão e simplicidade operacional.
- Manter o gerador atual como fallback verificável até a nova impressão passar no Chromium e em teste real de papel.
- Não alterar `work_orders`, os registros emitidos nem o PDF histórico do orçamento apenas para trocar apresentação.
- **Decisão pendente:** hoje a reimpressão renderiza os dados congelados com o **layout corrente**; uma troca de template mudará a aparência de futuras reimpressões. Caso seja necessário preservar também o layout exato de cada OS histórica, aprovar antes uma política de versionamento de template ou arquivamento do PDF renderizado.

## 6. Testes mínimos ao trocar o template

Reexecutar os testes em `server/tests/work-orders.test.ts`, o CI principal e `tests/browser/work_order_flow.py` em 1440, 390 e 320 px. Adicionar casos de PDF extenso (mais de uma página), acentuação, campos ausentes e renderização com fonte incorporada. Verificar manualmente uma impressão física antes de considerar o layout definitivo.

**Não incluído neste documento:** escolha de modelo A/B, mudanças no Coda, integrações externas, merge, deploy ou migração em ambiente alheio ao desenvolvimento.
