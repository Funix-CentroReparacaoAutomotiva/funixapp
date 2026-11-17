import type {WorkOrder} from '../shared/work-order.ts'
import {documentPdf} from './pdf.ts'
import {deliveryDateLabel} from '../shared/delivery-date.ts'

/** No prices, financial fields, calculated energy or commercial terms. */
export function operationalParagraphs(order:WorkOrder):string[] {
  const scope=order.scope
  const paragraphs=[
    'FUNIX | ORDEM DE SERVIÇO '+order.number+(order.scope.deliveryDate!==undefined||order.revision?' R'+String(order.revision??1).padStart(2,'0'):''),
    'Via operacional para execução. Não é proposta comercial.',
    '',
    'Orçamento de origem: '+(order.budgetNumber||'sem número comercial')+
      ' | Versão '+order.budgetLabel+' | ID '+order.budgetVersionId,
    'Criada em: '+new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(order.createdAt)),
    'Autorização: confirmada no aplicativo em '+new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(order.authorization.confirmedAt))+
      '. Operador individual não identificado pela autenticação atual.',
    '',
    'Cliente: '+(scope.customer.name||'Não informado'),
    'Veículo: '+(scope.vehicle.description||'Não informado')+
      ' | Placa: '+(scope.vehicle.plate||'Não informada'),
    '',
    ...(scope.deliveryDate!==undefined?['Data prevista de entrega: '+deliveryDateLabel(scope.deliveryDate),'']:[]),
    'DIAGNÓSTICOS'
  ]
  for(const item of scope.diagnostics) {
    paragraphs.push(item.pieceName+(item.diagnosis?' | '+item.diagnosis:'')+
      (item.intensity?' | Intensidade: '+item.intensity:''))
    if(item.notes)paragraphs.push('Observação do diagnóstico: '+item.notes)
  }
  paragraphs.push('','SERVIÇOS E COMPONENTES AUTORIZADOS')
  for(const item of scope.lines) {
    paragraphs.push('',item.pieceName+' | '+(item.kind==='service'?'Serviço: ':'Componente: ')+item.name,
      'Quantidade: '+item.quantity+(item.dimension?' | Dimensão: '+item.dimension:'')+
      (item.diagnosis?' | Diagnóstico: '+item.diagnosis:''))
    if(item.notes)paragraphs.push('Observação: '+item.notes)
    for(const stage of item.stages)
      paragraphs.push('Etapa técnica: '+stage.name+(stage.dimension?' | Dimensão: '+stage.dimension:''))
  }
  if(scope.deadlineDays!==null)
    paragraphs.push('','Prazo de execução previsto na versão emitida: '+scope.deadlineDays+
      ' dias úteis. Não representa data de entrega confirmada.')
  paragraphs.push('','Qualquer alteração material de escopo depende de nova autorização.')
  return paragraphs
}

export function workOrderPdf(order:WorkOrder):Buffer {
  return documentPdf(operationalParagraphs(order),order.number,{wrapAtWords:true})
}
