import type {CommercialWorkspace,DiagnosisItem,Scenario} from '../shared/commercial.ts'
export type SelectionPhase='idle'|'saving'|'blocked'
export interface SelectionState {phase:SelectionPhase;intents:ReadonlyMap<string,boolean>;error:unknown|null}
export interface PieceSelectionTransport {
 read(scenario:string):Promise<CommercialWorkspace>
 add(codes:string[],scenario:string,revision:number):Promise<DiagnosisItem[]>
 flags(flags:Record<string,boolean>,scenario:string,revision:number):Promise<Scenario>
 confirmed(workspace:CommercialWorkspace):void
 changed(state:SelectionState):void
}
export const emptySelectionState=():SelectionState=>({phase:'idle',intents:new Map(),error:null})
// In-memory UI intentions only. The existing SQLite/API remains authoritative.
export class PieceSelectionQueue {
 private intents=new Map<string,boolean>()
 private codes=new Map<string,string>()
 private workspace:CommercialWorkspace|null=null
 private phase:SelectionPhase='idle'
 private error:unknown=null
 private running=false
 private active=true
 private epoch=0
 private at:string
 private io:PieceSelectionTransport
 constructor(at:string,io:PieceSelectionTransport){this.at=at;this.io=io}
 private emit(){if(this.active)this.io.changed({phase:this.phase,intents:new Map(this.intents),error:this.error})}
 private scene(w=this.workspace!){const s=w.scenarios.find(s=>s.id===w.selectedId);if(!s)throw Error('Cenário indisponível. Seleções locais preservadas.');return s}
 private validate(w:CommercialWorkspace,scenario:string){
  if(!w||!Array.isArray(w.items)||!Array.isArray(w.scenarios)||!Array.isArray(w.components)||!Array.isArray(w.calculations)||w.selectedId!==scenario)throw Error('Não foi possível confirmar o cenário. Seleções locais preservadas.')
  const s=w.scenarios.find(s=>s.id===scenario)
  if(!s||s.atendimentoId!==this.at||!Number.isSafeInteger(s.revision)||s.revision<1||!s.pieceFlags||Object.values(s.pieceFlags).some(v=>typeof v!=='boolean')||w.items.some(p=>p.atendimentoId!==this.at||typeof p.id!=='string'||typeof p.pieceId!=='string'))throw Error('Confirmação de seleção inválida. Confira os dados antes de retomar.')
  return w
 }
 get status():SelectionPhase{return this.phase}
 desired(code:string,confirmed:boolean){return this.intents.get(code)??confirmed}
 private selected(code:string,w=this.workspace!){const item=w.items.find(p=>p.pieceId===this.codes.get(code));return Boolean(item&&this.scene(w).pieceFlags[item.id])}
 private reconcile(){for(const [code,desired]of this.intents)if(this.selected(code)===desired)this.intents.delete(code)}
 enqueue(codes:string[],enabled:boolean,w:CommercialWorkspace,identities:ReadonlyMap<string,string>){
  if(!this.active||this.phase==='blocked')return false
  if(this.phase==='idle'){const incoming=this.validate(w,w.selectedId);if(!this.workspace||this.workspace.selectedId!==incoming.selectedId||this.scene(this.workspace).revision<=this.scene(incoming).revision)this.workspace=incoming;this.codes=new Map(identities)}
  if(w.selectedId!==this.workspace!.selectedId||codes.some(code=>!this.codes.has(code)))return false
  for(const code of new Set(codes))this.intents.set(code,enabled)
  this.phase='saving';this.error=null;this.emit()
  // Consolidate taps from the same event, while retaining the final intention per code.
  queueMicrotask(()=>{void this.drain()});return true
 }
 private async read(scenario:string,epoch:number){
  const w=this.validate(await this.io.read(scenario),scenario)
  if(!this.active||this.epoch!==epoch)return false
  for(const code of this.intents.keys()){const old=this.workspace!.items.find(p=>p.pieceId===this.codes.get(code));if(old&&!w.items.some(p=>p.id===old.id&&p.pieceId===old.pieceId))throw Error('Uma peça pendente foi removida em outra edição. Descarte as intenções e confira a composição antes de selecionar novamente.')}
  this.workspace=w;this.io.confirmed(w);this.reconcile();this.emit();return true
 }
 private async drain(){
  if(this.running||!this.active||this.phase==='blocked'||!this.workspace)return
  this.running=true;const epoch=this.epoch,scenario=this.workspace.selectedId
  try{
   while(this.intents.size&&this.active&&epoch===this.epoch){
    this.reconcile()
    if(!this.intents.size)break
    const missing=[...this.intents].filter(([code,on])=>on&&!this.workspace!.items.some(p=>p.pieceId===this.codes.get(code))).map(([code])=>code).slice(0,2)
    const s=this.scene()
    if(missing.length){
     const result=await this.io.add(missing,scenario,s.revision)
     if(!Array.isArray(result)||missing.some(code=>!result.some(p=>p.atendimentoId===this.at&&p.pieceId===this.codes.get(code)&&typeof p.id==='string')))throw Error('Inclusão sem confirmação legível. Confira o estado salvo antes de retomar.')
    }else{
     const flags:Record<string,boolean>={}
     for(const [code,on]of this.intents){const item=this.workspace!.items.find(p=>p.pieceId===this.codes.get(code));if(item&&Boolean(s.pieceFlags[item.id])!==on)flags[item.id]=on}
     if(!Object.keys(flags).length)break
     const ack=await this.io.flags(flags,scenario,s.revision)
     if(!ack||ack.id!==scenario||ack.atendimentoId!==this.at||!Number.isSafeInteger(ack.revision)||ack.revision<=s.revision||Object.entries(flags).some(([id,on])=>ack.pieceFlags?.[id]!==on))throw Error('Confirmação de inclusões inválida. Confira os dados antes de retomar.')
    }
    // No blind retry, including when the write succeeded but this read fails.
    if(!await this.read(scenario,epoch))return
   }
   if(this.active&&epoch===this.epoch){this.phase='idle';this.error=null;this.emit()}
  }catch(error){if(this.active&&epoch===this.epoch){this.phase='blocked';this.error=error;this.emit()}}
  finally{this.running=false}
 }
 async recover(){
  if(this.running||!this.active||this.phase!=='blocked'||!this.workspace)return false
  this.running=true;this.phase='saving';this.error=null;this.emit();const epoch=this.epoch
  try{if(!await this.read(this.workspace.selectedId,epoch))return;this.phase=this.intents.size?'saving':'idle';this.emit()}
  catch(error){this.phase='blocked';this.error=error;this.emit()}
  finally{this.running=false}
  if(this.phase==='saving')await this.drain()
  return this.status==='idle'
 }
 discard(){if(this.running)return false;this.intents.clear();this.workspace=null;this.phase='idle';this.error=null;this.emit();return true}
 suspend(){this.active=false;this.epoch++}
 resume(){this.active=true;this.emit()}
}
