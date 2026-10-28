import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ComponentItem } from '../shared/pricing.ts'
import { conflict,inputObject,invalid,selectedScenario,touchComposition,transaction } from './scenarios.ts'
import { decimal,optionalDecimal } from './pricing-config.ts'

export class ComponentRepository {
 readonly db:DatabaseSync
 constructor(db:DatabaseSync){this.db=db}
 list(at:string):ComponentItem[]{return this.db.prepare('SELECT * FROM component_items WHERE atendimento_id=? ORDER BY created_at,id').all(at).map(r=>({id:String(r.id),atendimentoId:at,pieceId:String(r.piece_id),name:String(r.name),quantity:String(r.quantity),manualPrice:r.manual_price===null?null:String(r.manual_price),fct:r.fct===null?null:String(r.fct),notes:String(r.notes),revision:Number(r.revision)}))}
 save(at:string,input:unknown,id?:string){
  const data=inputObject(input,['revision','pieceId','name','quantity','manualPrice','fct','notes','scenarioId','scenarioRevision','clientId'])
  return transaction(this.db,()=>{
   const selected=selectedScenario(this.db,at,data.scenarioId,data.scenarioRevision)
   const old=id?this.list(at).find(c=>c.id===id):undefined
   if(id && !old)invalid('Componente não pertence a este Atendimento.')
   if(old && old.revision!==data.revision)conflict()
   if(typeof data.pieceId!=='string' || !this.db.prepare('SELECT id FROM diagnosis_items WHERE atendimento_id=? AND id=?').get(at,data.pieceId))invalid('Peça não pertence ao Atendimento.')
   if(old && old.pieceId!==data.pieceId)invalid('Para trocar peça, exclua e crie outro lançamento com confirmação.')
   if(typeof data.name!=='string' || !data.name.trim() || data.name.length>250 || typeof data.notes!=='string' || data.notes.length>8000)invalid('Descrição/observações de componente inválidas.')
   if(data.clientId!==undefined && (typeof data.clientId!=='string'||!/^[a-f0-9-]{36}$/.test(data.clientId)))invalid('Identificador de criação inválido.')
   const quantity=decimal(data.quantity,true),manualPrice=optionalDecimal(data.manualPrice),fct=data.fct===undefined?old?.fct??null:optionalDecimal(data.fct)
   const key=old?.id ?? (data.clientId as string|undefined) ?? randomUUID(),now=new Date().toISOString()
   if(!id && data.clientId){const existing=this.list(at).find(c=>c.id===key);if(existing){if(existing.pieceId!==data.pieceId||existing.name!==data.name.trim()||existing.quantity!==quantity||existing.manualPrice!==manualPrice||existing.notes!==data.notes)conflict();return existing}}
   if(old)this.db.prepare('UPDATE component_items SET name=?,quantity=?,manual_price=?,fct=?,notes=?,revision=revision+1,updated_at=? WHERE id=?').run(data.name.trim(),quantity,manualPrice,fct,data.notes,now,key)
   else {
    this.db.prepare('INSERT INTO component_items(id,atendimento_id,piece_id,name,quantity,manual_price,fct,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(key,at,data.pieceId,data.name.trim(),quantity,manualPrice,fct,data.notes,now,now)
    this.db.prepare('UPDATE scenario_component_flags SET enabled=1 WHERE scenario_id=? AND component_id=?').run(selected,key)
   }
   touchComposition(this.db,at)
   return this.list(at).find(c=>c.id===key)!
  })
 }
 remove(at:string,id:string,input:unknown){
  const data=inputObject(input,['revision'])
  return transaction(this.db,()=>{
   const old=this.list(at).find(c=>c.id===id)
   if(!old)invalid('Componente não encontrado neste Atendimento.')
   if(old.revision!==data.revision)conflict()
   this.db.prepare('DELETE FROM component_items WHERE id=?').run(id);touchComposition(this.db,at)
   return {removed:true}
  })
 }
}
