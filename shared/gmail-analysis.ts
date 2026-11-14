import type {UpdatePackage} from './update-packages.ts'
export const gmailFactFields=['processId','partner','contact','plate','vehicle','atendimentoId','experienceId','budgetId','budgetVersion','scope','amount','conditions','reservations','dates','requests','authorization'] as const
export type GmailFactField=typeof gmailFactFields[number]
export type GmailFact={field:GmailFactField,value:string|null,provenance:'declared'|'inferred'|'unknown',evidence:{part:'subject'|'body',start:number,end:number,quote:string}|null}
export type GmailAttachment={attachmentId:string,name:string,mime:string,size:number,digest:string|null}
export type GmailAnalysisSource={accountId:string,messageId:string,subject:string,digest:string,attachments:GmailAttachment[]}
export type GmailExtraction={source:GmailAnalysisSource,facts:GmailFact[]}
export type GmailContextRecord={rowId:string,processId:string|null,experienceId:string|null,plate:string|null,vehicle:string|null,partner:string|null,budgetId:string|null,budgetVersion:string|null}
export type GmailContext={status:'matched'|'not_found'|'ambiguous'|'conflict'|'needs_identity',candidates:GmailContextRecord[],selected:GmailContextRecord|null,observedAt:string,digest:string,conflicts:string[],humanSelection:string|null}
export type GmailAnalysisResult={extraction:GmailExtraction,context:GmailContext,summary:string,clarifications:Record<string,string>}
export type GmailAnalysisState='queued'|'processing'|'ready'|'needs_information'|'failed'
export type GmailAnalysis={noticeId:string,state:GmailAnalysisState,attempts:number,errorCode:string|null,nextAttemptAt:string|null,generation:number,updatedAt:string,result:GmailAnalysisResult|null,proposal:UpdatePackage|null}
export type GmailAnalysisList={enabled:boolean,items:GmailAnalysis[]}
export const gmailFactLabels:Record<GmailFactField,string>={processId:'Processo',partner:'Parceiro',contact:'Cliente ou contato',plate:'Placa',vehicle:'Veículo',atendimentoId:'Atendimento',experienceId:'Experiência',budgetId:'Orçamento',budgetVersion:'Versão do orçamento',scope:'Escopo',amount:'Valor declarado',conditions:'Condições',reservations:'Ressalvas',dates:'Datas ou prazos',requests:'Providências solicitadas',authorization:'Autorização declarada'}
