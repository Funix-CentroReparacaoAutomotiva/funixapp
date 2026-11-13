import type {DiagnosisItem,Scenario} from './commercial.ts'
import {codaServiceId} from './commercial-curation.ts'
export const INSTALLMENT_PLANS = [['tres',3],['seis',6],['nove',9],['doze',12]] as const
export type InstallmentKey = typeof INSTALLMENT_PLANS[number][0]
export interface InstallmentConfiguration {revision:number;updatedAt:string;rates:Record<InstallmentKey,string>}
export interface InstallmentSnapshot {
 revision:number;rates:InstallmentConfiguration['rates'];rounding:'half-up-cent-independent'
 plans:Record<InstallmentKey,{count:number;percent:string;total:string;unit:string;exactTotal:{n:string;d:string};exactUnit:{n:string;d:string};displayDifference:string}>
}
export interface ScenarioDeadline {mode:'automatic'|'manual';manualDays:number|null}
export interface ExecutionDeadline extends ScenarioDeadline {technicalDays:string|null;effectiveDays:number|null;warning:string|null}

export type Installment={valorParcela:string;total:string}
export type JsreportTerms={
 prazoDiasUteis:string
 parcelamento:{tres:Installment;seis:Installment;nove:Installment;doze:Installment}
}
export interface JsreportDocument{
 meta:{id:string;dataCriacao:string}
 cliente:{nome:string;contato:string}
 veiculo:{modelo:string;placa:string}
 diagnosticos:{nome:string;resumo:string;totalServicos:string;totalComponentes:string;clusters:({tipo:'servico';nome:string;valor:string;descricaoTexto:string[]}|{tipo:'itens';nome:'Itens';valor:string;itensDetalhados:{nome:string;valorUnitario:string;quantidade:string;valorTotal:string}[]})[]}[]
 condicoes:{prazo:string}
 parcelamento:JsreportTerms['parcelamento']
 financeiro:{servicos:string;pecas:string;desconto:string;totalVista:string}
}

// Only the curated commercial service ID, never a textual name or a technical stage.
const PAINT_SERVICE_ID=codaServiceId('i-XDTMBmueos')
export function hasIncludedPainting(items:DiagnosisItem[],scenario:Scenario):boolean{
 return items.some(piece=>scenario.pieceFlags[piece.id]===true&&piece.services.some(service=>scenario.serviceFlags[service.id]===true&&service.serviceId===PAINT_SERVICE_ID))
}
export function executionDeadline(setting:ScenarioDeadline|undefined,technicalDays:string|null,paintingIncluded=false):ExecutionDeadline{
 const configured=setting??{mode:'automatic',manualDays:null}
 const suggestion=technicalDays&&/^\d+$/.test(technicalDays)&&Number.isSafeInteger(Number(technicalDays))&&Number(technicalDays)>0?Number(technicalDays):null
 const requested=configured.mode==='manual'?configured.manualDays:suggestion
 // Do not invent a technical estimate when energy/capacity is missing.
 const effectiveDays=requested===null?null:paintingIncluded?Math.max(requested,5):requested
 const floorApplied=paintingIncluded&&requested!==null&&requested<5
 const warning=floorApplied
  ?configured.mode==='manual'?'Prazo manual inferior ao mínimo de 5 dias úteis devido à pintura; o orçamento utilizará 5 dias úteis.':'Prazo mínimo de 5 dias úteis aplicado devido à pintura.'
  :configured.mode==='manual'&&effectiveDays!==null?(suggestion===null?'Estimativa técnica de prazo indisponível; será utilizado o prazo manual informado.':effectiveDays<suggestion?'Prazo manual menor que a sugestão técnica atual.':null):null
 return {...configured,technicalDays,effectiveDays,warning}
}
