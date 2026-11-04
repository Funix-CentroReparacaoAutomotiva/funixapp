// Synthetic domain references only. Never seeded in application startup or installed databases.
import type{CatalogItem}from'../../../shared/commercial.ts'
import type{VoicePlanningContext,VoiceCommandBatch}from'../../../shared/voice-commands.ts'
import{voiceRevisions}from'../../voice-planner.ts'
export const V={at:'11111111-1111-4111-8111-111111111111',one:'22222222-2222-4222-8222-222222222222',two:'33333333-3333-4333-8333-333333333333',piece:'44444444-4444-4444-8444-444444444444',body:'55555555-5555-4555-8555-555555555555',paint:'66666666-6666-4666-8666-666666666666',rear:'qa:piece:rear',front:'qa:piece:front',dent:'qa:diagnosis:dent',scratch:'qa:diagnosis:scratch',bodyService:'qa:service:body',paintService:'qa:service:paint',montage:'qa:service:montage',optional:'qa:service:optional',bodyM:'qa:dim:body-m',partial:'qa:dim:paint-partial',complete:'qa:dim:paint-complete',montageM:'qa:dim:montage-m',optionalM:'qa:dim:optional-m'}as const
export function voiceCatalog(id:string,kind:CatalogItem['kind'],name:string,serviceId:string|null=null):CatalogItem{return{id,kind,name,code:kind==='peca'?id.replaceAll(':','-'):null,status:'proposta',source:'operador',suggestion:false,side:'',serviceId,active:true,revision:1,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'}}
export function voiceFixture():VoicePlanningContext{
 const catalog=[voiceCatalog(V.rear,'peca','Para-choque traseiro QA'),voiceCatalog(V.front,'peca','Para-choque dianteiro QA'),voiceCatalog(V.dent,'diagnostico','Amassado QA'),voiceCatalog(V.scratch,'diagnostico','Riscado QA'),voiceCatalog(V.bodyService,'servico','Funilaria QA'),voiceCatalog(V.paintService,'servico','Pintura QA'),voiceCatalog(V.montage,'servico','Montagem QA'),voiceCatalog(V.optional,'servico','Opcional QA'),voiceCatalog(V.bodyM,'dimensao','M',V.bodyService),voiceCatalog(V.partial,'dimensao','Parcial',V.paintService),voiceCatalog(V.complete,'dimensao','Completa',V.paintService),voiceCatalog(V.montageM,'dimensao','M',V.montage),voiceCatalog(V.optionalM,'dimensao','M',V.optional)]
 return{atendimentoId:V.at,catalog,workspace:{selectedId:V.one,revision:4,configurationRevision:2,components:[],items:[{id:V.piece,pieceId:V.rear,atendimentoId:V.at,revision:3,diagnosisId:V.dent,intensity:'moderado',notes:'Observação manual preservada',enabled:true,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',services:[{id:V.body,serviceId:V.bodyService,dimensionId:V.bodyM,quantity:'1.25',enabled:true,notes:'Funilaria manual'},{id:V.paint,serviceId:V.paintService,dimensionId:V.partial,quantity:'1',enabled:false,notes:'Pintura manual'}]}],scenarios:[{id:V.one,atendimentoId:V.at,name:'Cenário sintético 1',position:1,revision:8,pieceFlags:{[V.piece]:true},serviceFlags:{[V.body]:true,[V.paint]:false},componentFlags:{}},{id:V.two,atendimentoId:V.at,name:'Cenário sintético 2',position:2,revision:6,pieceFlags:{[V.piece]:true},serviceFlags:{[V.body]:false,[V.paint]:true},componentFlags:{}}]},recommendations:[{diagnosisId:V.dent,intensity:'moderado',availability:'available',rules:[{id:'qa-rule-body',sourceRowId:'i-qa-body',sourceTable:'qa-relations',serviceId:V.bodyService,dimensionId:V.bodyM,selectedByDefault:true},{id:'qa-rule-paint',sourceRowId:'i-qa-paint',sourceTable:'qa-relations',serviceId:V.paintService,dimensionId:V.complete,selectedByDefault:true},{id:'qa-rule-montage',sourceRowId:'i-qa-montage',sourceTable:'qa-relations',serviceId:V.montage,dimensionId:V.montageM,selectedByDefault:true},{id:'qa-rule-optional',sourceRowId:'i-qa-optional',sourceTable:'qa-relations',serviceId:V.optional,dimensionId:V.optionalM,selectedByDefault:false}]}]}
}
export function voiceExampleBatches(context=voiceFixture()){
 const first:VoiceCommandBatch={format:'funix-voice-commands-v1',idempotencyKey:'synthetic-voice-first',atendimentoId:context.atendimentoId,scenarioId:context.workspace.selectedId,expected:voiceRevisions(context),commands:[
  {id:'piece',intent:'instruction',op:'add_piece',piece:{state:'resolved',id:V.rear}},
  {id:'diagnosis',intent:'instruction',op:'set_diagnosis',piece:{state:'resolved',id:V.rear},diagnosis:{state:'resolved',id:V.dent},intensity:'moderado'},
  {id:'body',intent:'instruction',op:'add_service',piece:{state:'resolved',id:V.rear},service:{state:'resolved',id:V.bodyService},dimension:{state:'resolved',id:V.bodyM}},
  {id:'paint',intent:'instruction',op:'add_service',piece:{state:'resolved',id:V.rear},service:{state:'resolved',id:V.paintService},dimension:{state:'resolved',id:V.partial}},
 ]}
 const correction:VoiceCommandBatch={...first,idempotencyKey:'synthetic-voice-correction',commands:[{id:'paint-complete',intent:'correction',op:'set_dimension',piece:{state:'resolved',id:V.rear},line:{kind:'id',id:V.paint},dimension:{state:'resolved',id:V.complete}}]}
 return{first,correction}
}

export function voiceExampleCases(){
 const fresh=voiceFixture();fresh.workspace.items=[];for(const s of fresh.workspace.scenarios){s.pieceFlags={};s.serviceFlags={}}
 const existing=voiceFixture(),commands=voiceExampleBatches(existing)
 const ambiguous:VoiceCommandBatch={...commands.first,idempotencyKey:'synthetic-voice-ambiguous',commands:[{id:'unclear-piece',intent:'instruction',op:'add_piece',piece:{state:'unresolved',text:'para-choque, lado não informado',candidates:[V.front,V.rear]}},{id:'independent-notes',intent:'instruction',op:'set_notes',piece:{state:'resolved',id:V.rear},value:'Anotação explícita independente'}]}
 return[
  {name:'01-criacao',context:fresh,input:voiceExampleBatches(fresh).first},
  {name:'02-correcao-pintura',context:existing,input:commands.correction},
  {name:'03-ambiguidade-independente',context:existing,input:ambiguous},
 ]
}
