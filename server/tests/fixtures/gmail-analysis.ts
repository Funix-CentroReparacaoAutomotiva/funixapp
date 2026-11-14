import type {SyntheticAnalysisFixture} from '../../gmail-analysis-providers.ts'
import type {GmailContextRecord,GmailFactField} from '../../../shared/gmail-analysis.ts'
export const analysisRecord=(overrides:Partial<GmailContextRecord>={}):GmailContextRecord=>({rowId:'i-caseA',processId:'12345',experienceId:'XP1234',plate:'ABC1D23',vehicle:'Veículo sintético',partner:'Associação sintética',budgetId:'ORC-10',budgetVersion:'A',...overrides})
export function analysisFixture():SyntheticAnalysisFixture{
 const message={accountId:'synthetic@funix.invalid',messageId:'a'.repeat(16),subject:'Autorização de reparo — processo 12345',body:'Autorizamos o reparo do processo 12345, conforme orçamento ORC-10. Favor informar previsão de início.',attachments:[{attachmentId:'synthetic-attachment',name:'autorizacao-sintetica.pdf',mime:'application/pdf',size:120,digest:null}]}
 const claim=(field:GmailFactField,value:string)=>({field,value,part:'body',start:message.body.indexOf(value),end:message.body.indexOf(value)+value.length,provenance:'declared'})
 return {synthetic:true,messages:[{message,interpretation:{claims:[claim('processId','12345'),claim('budgetId','ORC-10'),claim('authorization','Autorizamos o reparo'),claim('requests','Favor informar previsão de início.')]}}],records:[analysisRecord()]}
}
export const analysisNotice=()=>({messageId:'a'.repeat(16),title:'Autorização sintética de reparo',summary:'Parceiro informa autorização. Processo 12345, sem confirmação de data.',relevance:'relevant' as const,reason:'REPAIR_AUTHORIZATION',plateHint:null,xpHint:null})
