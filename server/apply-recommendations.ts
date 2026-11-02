import{createHash,randomUUID}from'node:crypto'
import type{DatabaseSync}from'node:sqlite'
import type{RecommendationApplication}from'../shared/commercial.ts'
import{DIAGNOSIS_INTENSITIES}from'../shared/commercial.ts'
import{newServiceSelectionIssue,compareRecommendations}from'../shared/commercial-curation.ts'
import{recommendations}from'./diagnosis-recommendations.ts'
import{AtendimentoRepository}from'./atendimentos.ts'
import{CommercialRepository}from'./commercial.ts'
import{transaction,inputObject,selectedScenario,touchComposition,conflict,invalid}from'./scenarios.ts'
import{ServiceError}from'./errors.ts'

export function applySuggestedServices(db:DatabaseSync,at:string,pieceId:string,input:unknown):RecommendationApplication{
 const data=inputObject(input,['revision','scenarioId','scenarioRevision','diagnosisId','intensity','mode','ruleIds','idempotencyKey'])
 if(!Number.isSafeInteger(data.revision)||Number(data.revision)<1||!Number.isSafeInteger(data.scenarioRevision)||Number(data.scenarioRevision)<1||typeof data.scenarioId!=='string'||!data.scenarioId||data.scenarioId.length>100||typeof data.diagnosisId!=='string'||!data.diagnosisId||data.diagnosisId.length>100||!DIAGNOSIS_INTENSITIES.includes(data.intensity as typeof DIAGNOSIS_INTENSITIES[number])||(data.mode!=='automatic'&&data.mode!=='assisted')||typeof data.idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(data.idempotencyKey))invalid('Informe contexto, revisões e chave válidos para aplicar serviços sugeridos.')
 if(data.mode==='assisted'&&(!Array.isArray(data.ruleIds)||data.ruleIds.length>100||data.ruleIds.some(id=>typeof id!=='string'||!id||id.length>180)||new Set(data.ruleIds).size!==data.ruleIds.length))invalid('Selecione regras sem duplicação.')
 if(data.mode==='automatic'&&data.ruleIds!==undefined)invalid('A aplicação inicial utiliza todas as recomendações elegíveis da combinação.')
 const request={revision:data.revision,scenarioId:data.scenarioId,scenarioRevision:data.scenarioRevision,diagnosisId:data.diagnosisId,intensity:data.intensity,mode:data.mode,ruleIds:data.mode==='assisted'?[...(data.ruleIds as string[])].sort():null},requestHash=createHash('sha256').update(JSON.stringify(request)).digest('hex')
 return transaction(db,()=>{
  new AtendimentoRepository(db).get(at)
  const scene=selectedScenario(db,at,data.scenarioId),piece=db.prepare('SELECT * FROM diagnosis_items WHERE id=? AND atendimento_id=?').get(pieceId,at)
  if(!piece)throw new ServiceError(404,'NOT_FOUND','Peça não pertence a este Atendimento.')
  const receipt=db.prepare('SELECT request_hash,result FROM recommendation_applications WHERE piece_id=? AND scenario_id=? AND request_key=?').get(pieceId,scene,data.idempotencyKey as string)
  if(receipt){if(receipt.request_hash!==requestHash)conflict();return JSON.parse(String(receipt.result))as RecommendationApplication}
  selectedScenario(db,at,scene,data.scenarioRevision)
  if(piece.revision!==data.revision||piece.diagnosis_id!==data.diagnosisId||piece.intensity!==data.intensity)conflict()
  const existing=db.prepare('SELECT service_id FROM diagnosis_services WHERE diagnosis_item_id=?').all(pieceId),hasComponents=Boolean(db.prepare('SELECT id FROM component_items WHERE piece_id=? LIMIT 1').get(pieceId))
  const notEmpty=data.mode==='automatic'&&(existing.length>0||hasComponents),all=recommendations(db,data.diagnosisId,data.intensity).sort(compareRecommendations),selected=data.mode==='assisted'?new Set(data.ruleIds as string[]):null
  const skipped:RecommendationApplication['skipped']=[],candidates=notEmpty?[]:all.filter(r=>!selected||selected.has(r.id)),present=new Set(existing.map(r=>String(r.service_id)))
  if(selected)for(const id of selected)if(!all.some(r=>r.id===id))skipped.push({ruleId:id,reason:'NOT_AVAILABLE'})
  const eligible=candidates.filter(r=>{
   const reason=newServiceSelectionIssue(r.serviceId)
   if(reason){skipped.push({ruleId:r.id,reason:'CURATION_BLOCKED'});return false}
   if(present.has(r.serviceId)){skipped.push({ruleId:r.id,reason:'ALREADY_PRESENT'});return false}
   return true
  })
  const ambiguous=new Set(eligible.filter(r=>eligible.filter(v=>v.serviceId===r.serviceId).length>1).map(r=>r.serviceId))
  if(data.mode==='assisted'&&ambiguous.size)invalid('Escolha apenas uma recomendação por serviço; dimensões existentes não serão substituídas.')
  const planned=eligible.filter(r=>{if(ambiguous.has(r.serviceId)){skipped.push({ruleId:r.id,reason:'CHOOSE_DIMENSION'});return false}return true})
  if(existing.length+planned.length>50)throw new ServiceError(422,'RECOMMENDATION_LIMIT','A aplicação ultrapassaria 50 serviços. Nenhuma linha foi incluída.')
  const created:RecommendationApplication['created']=[]
  for(const r of planned){
   const lineId=randomUUID()
   db.prepare("INSERT INTO diagnosis_services(id,diagnosis_item_id,service_id,dimension_id,quantity,enabled,notes,diagnosis_id,recommendation_rule_id)VALUES(?,?,?,?, '1',0,'',NULL,?)").run(lineId,pieceId,r.serviceId,r.dimensionId,r.id)
   db.prepare('UPDATE scenario_service_flags SET enabled=? WHERE scenario_id=? AND service_id=?').run(r.selectedByDefault?1:0,scene,lineId)
   created.push({lineId,ruleId:r.id})
  }
  if(created.length){db.prepare('UPDATE diagnosis_items SET revision=revision+1,updated_at=? WHERE id=?').run(new Date().toISOString(),pieceId);touchComposition(db,at)}
  const result:RecommendationApplication={item:new CommercialRepository(db).list(at,scene).find(p=>p.id===pieceId)!,scenarioRevision:Number(db.prepare('SELECT revision FROM scenarios WHERE id=?').get(scene)!.revision),idempotencyKey:data.idempotencyKey as string,created,skipped,notEmpty}
  db.prepare('INSERT INTO recommendation_applications(piece_id,scenario_id,request_key,request_hash,result)VALUES(?,?,?,?,?)').run(pieceId,scene,data.idempotencyKey as string,requestHash,JSON.stringify(result))
  return result
 })
}
