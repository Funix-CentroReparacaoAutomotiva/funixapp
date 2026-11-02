import type {CommercialWorkspace,DiagnosisItem,PieceRemoval} from '../shared/commercial.ts'
import {removalRequest,removalReview} from '../shared/piece-removal.ts'
import type {RemovalReview} from '../shared/piece-removal.ts'
export type SelectionPhase='idle'|'saving'|'blocked'
export interface SelectionState {phase:SelectionPhase;intents:ReadonlyMap<string,boolean>;error:unknown|null}
export interface PieceSelectionTransport {
 read(scenario:string):Promise<CommercialWorkspace>
 add(codes:string[],scenario:string,revision:number):Promise<DiagnosisItem[]>
 remove(request:PieceRemoval):Promise<{removedIds:string[]}>
 confirmRemoval(review:RemovalReview):Promise<boolean>
 confirmed(workspace:CommercialWorkspace):void
 changed(state:SelectionState):void
}
export const emptySelectionState=():SelectionState=>({phase:'idle',intents:new Map(),error:null})
// In-memory intentions; shared composition, never scenario flags, is authoritative here.
export class PieceSelectionQueue {
 private intents=new Map<string,boolean>()
 private codes=new Map<string,string>()
 private consent=new Map<string,string>()
 private removing=new Map<string,string>()
 private requests=new Map<string,number>()
 private batches=new Map<string,string[]>()
 private workspace:CommercialWorkspace|null=null
 private phase:SelectionPhase='idle'
 private error:unknown=null
 private running=false
 private active=true
 private epoch=0
 private sequence=0
 private at:string
 private io:PieceSelectionTransport
 constructor(at:string,io:PieceSelectionTransport){this.at=at;this.io=io}
 private emit(){if(this.active)this.io.changed({phase:this.phase,intents:new Map(this.intents),error:this.error})}
 private scene(w=this.workspace!){const s=w.scenarios.find(s=>s.id===w.selectedId);if(!s)throw Error('Cenário indisponível. Seleções locais preservadas.');return s}
 private validate(w:CommercialWorkspace,scenario:string){
  if(!w||!Array.isArray(w.items)||!Array.isArray(w.scenarios)||!Array.isArray(w.components)||!Array.isArray(w.calculations)||w.selectedId!==scenario||!Number.isSafeInteger(w.revision)||w.revision<1)throw Error('Não foi possível confirmar o cenário. Seleções locais preservadas.')
  const s=w.scenarios.find(s=>s.id===scenario)
  if(!s||w.scenarios.some(s=>s.atendimentoId!==this.at||!Number.isSafeInteger(s.revision)||s.revision<1||[s.pieceFlags,s.serviceFlags,s.componentFlags].some(flags=>!flags||typeof flags!=='object'||Object.values(flags).some(v=>typeof v!=='boolean')))||w.items.some(p=>p.atendimentoId!==this.at||typeof p.id!=='string'||typeof p.pieceId!=='string'||!Number.isSafeInteger(p.revision)||p.revision<1||!Array.isArray(p.services)))throw Error('Confirmação de seleção inválida. Confira os dados antes de retomar.')
  return w
 }
 get status():SelectionPhase{return this.phase}
 desired(code:string,confirmed:boolean){return this.intents.get(code)??confirmed}
 private item(code:string,w=this.workspace!){return w.items.find(p=>p.pieceId===this.codes.get(code))}
 private reconcile(){for(const [code,on]of this.intents)if(Boolean(this.item(code))===on){this.intents.delete(code);this.consent.delete(code);this.batches.delete(code)}}
 async enqueue(codes:string[],enabled:boolean,w:CommercialWorkspace,identities:ReadonlyMap<string,string>){
  if(!this.active||this.phase==='blocked')return false
  try{
   if(this.phase==='idle'){
    const incoming=this.validate(w,w.selectedId),current=this.workspace
    const older=current&&current.selectedId===incoming.selectedId&&current.revision>=incoming.revision&&incoming.scenarios.every(s=>current.scenarios.some(c=>c.id===s.id&&c.revision>=s.revision))
    if(!older)this.workspace=incoming
    this.codes=new Map(identities)
   }
   const unique=[...new Set(codes)],epoch=this.epoch,sequence=++this.sequence
   if(!unique.length||w.selectedId!==this.workspace!.selectedId||unique.some(code=>!this.codes.has(code)))return false
   unique.forEach(code=>this.requests.set(code,sequence))
   if(!enabled){
    const review=removalReview(this.workspace!,unique,this.codes),signatures=new Map(unique.map(code=>[code,removalReview(this.workspace!,[code],this.codes).signature]))
    // Before consent there is no optimistic change, dirty flag, GET or write.
    if(review.required&&!await this.io.confirmRemoval(review))return false
    if(!this.active||epoch!==this.epoch||this.status==='blocked'||unique.some(c=>this.requests.get(c)!==sequence))return false
    for(const code of unique)this.consent.set(code,signatures.get(code)!)
   }
   for(const code of unique){this.intents.set(code,enabled);this.batches.set(code,unique)}
   this.phase='saving';this.error=null;this.emit();queueMicrotask(()=>{void this.drain()});return true
  }catch(error){this.phase='blocked';this.error=error;this.emit();return false}
 }
 private async read(scenario:string,epoch:number){
  const w=this.validate(await this.io.read(scenario),scenario)
  if(!this.active||this.epoch!==epoch)return false
  for(const code of this.intents.keys()){
   const old=this.item(code),now=this.item(code,w)
   if(old&&(!now||old.id!==now.id)&&!(this.removing.get(code)===old.id&&!now))throw Error('Uma peça pendente foi removida ou substituída em outra edição. Descarte as intenções e confira a composição antes de selecionar novamente.')
  }
  this.workspace=w;this.io.confirmed(w);this.reconcile();this.emit();return true
 }
 private batch(candidates:string[]){
  if(!candidates.length)return []
  const first=candidates[0]!,group=this.batches.get(first)??[first]
  const owned=(codes:string[])=>codes.filter(c=>candidates.includes(c)&&this.batches.get(c)===codes)
  if(owned(group).length>1)return owned(group)
  // Consolidate independent taps, but never split a pending Ambos to fill another batch.
  return[first,...candidates.slice(1).filter(c=>owned(this.batches.get(c)??[c]).length<=1)].slice(0,2)
 }
 private async drain(){
  if(this.running||!this.active||this.phase==='blocked'||!this.workspace)return
  this.running=true;const epoch=this.epoch,scenario=this.workspace.selectedId
  try{
   while(this.intents.size&&this.active&&epoch===this.epoch){
    this.reconcile();if(!this.intents.size)break
    const missing=this.batch([...this.intents].filter(([code,on])=>on&&!this.item(code)).map(([code])=>code))
    if(missing.length){
     const result=await this.io.add(missing,scenario,this.scene().revision)
     if(!Array.isArray(result)||missing.some(code=>!result.some(p=>p.atendimentoId===this.at&&p.pieceId===this.codes.get(code)&&typeof p.id==='string')))throw Error('Inclusão sem confirmação legível. Confira o estado salvo antes de retomar.')
    }else{
     const codes=this.batch([...this.intents].filter(([code,on])=>!on&&this.item(code)).map(([code])=>code))
     if(!codes.length)break
     for(const code of codes){const r=removalReview(this.workspace,[code],this.codes);if(r.required&&this.consent.get(code)!==r.signature)throw Error('Conteúdo ou cenários da peça mudaram. Atualize os dados e confirme a remoção novamente.')}
     const request=removalRequest(this.workspace,codes,this.codes)
     codes.forEach(code=>this.removing.set(code,this.item(code)!.id))
     const ack=await this.io.remove(request)
     if(!ack||!Array.isArray(ack.removedIds)||ack.removedIds.length!==request.pieces.length||request.pieces.some(p=>!ack.removedIds.includes(p.id)))throw Error('Remoção sem confirmação legível. Confira o estado salvo antes de retomar.')
    }
    // Never replay a write when its acknowledgement or the following read is uncertain.
    if(!await this.read(scenario,epoch))return
   }
   if(this.active&&epoch===this.epoch){this.phase='idle';this.error=null;this.emit()}
  }catch(error){if(this.active&&epoch===this.epoch){this.phase='blocked';this.error=error;this.emit()}}
  finally{this.running=false}
 }
 async recover(){
  if(this.running||!this.active||this.phase!=='blocked'||!this.workspace)return false
  this.running=true;this.phase='saving';this.error=null;this.emit();const epoch=this.epoch
  try{
   if(!await this.read(this.workspace.selectedId,epoch))return false
   const codes=[...this.intents].filter(([c,on])=>!on&&this.item(c)&&removalReview(this.workspace!,[c],this.codes).required&&this.consent.get(c)!==removalReview(this.workspace!,[c],this.codes).signature).map(([c])=>c)
   if(codes.length){
    const review=removalReview(this.workspace,codes,this.codes),accepted=await this.io.confirmRemoval(review)
    if(!this.active||this.epoch!==epoch)return false
    for(const c of codes)if(accepted)this.consent.set(c,removalReview(this.workspace,[c],this.codes).signature);else{this.intents.delete(c);this.consent.delete(c);this.batches.delete(c)}
   }
   this.phase=this.intents.size?'saving':'idle';this.emit()
  }catch(error){this.phase='blocked';this.error=error;this.emit()}
  finally{this.running=false}
  if(this.phase==='saving')await this.drain()
  return this.status==='idle'
 }
 discard(){if(this.running)return false;this.intents.clear();this.consent.clear();this.removing.clear();this.requests.clear();this.batches.clear();this.epoch++;this.workspace=null;this.phase='idle';this.error=null;this.emit();return true}
 suspend(){this.active=false;this.epoch++}
 resume(){this.active=true;this.emit()}
}
