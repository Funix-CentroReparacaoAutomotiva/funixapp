import{hierarchyPiecePairs}from'./hierarchy.ts'
import type{DatabaseSync}from'node:sqlite'
import{CommercialRepository}from'./commercial.ts'
import{ScenarioRepository,selectedScenario}from'./scenarios.ts'
import{ComponentRepository}from'./components.ts'
import{PricingConfigurationRepository}from'./pricing-config.ts'
import{recommendations}from'./diagnosis-recommendations.ts'
import{DIAGNOSIS_INTENSITIES,catalogItemUsable}from'../shared/commercial.ts'
import{servicePolicy}from'../shared/commercial-curation.ts'
import type{VoicePlanningContext}from'../shared/voice-commands.ts'

// All repository methods used here are SELECT-only; do not call initialization.
export function readVoiceContext(db:DatabaseSync,at:string,scenarioId:string):VoicePlanningContext{
 const commercial=new CommercialRepository(db),scenarios=new ScenarioRepository(db),pricing=new PricingConfigurationRepository(db)
 const selected=selectedScenario(db,at,scenarioId),all=scenarios.list(at),catalog=commercial.catalogs().items,state=pricing.settings(at)
 return{atendimentoId:at,catalog,workspace:{selectedId:selected,scenarios:all,items:commercial.list(at,selected),
  revision:state.revision,configurationRevision:pricing.get().revision,
  components:new ComponentRepository(db).list(at).map(p=>({id:p.id,pieceId:p.pieceId,name:p.name,quantity:p.quantity,manualPrice:p.manualPrice,revision:p.revision}))},
 recommendations:catalog.filter(c=>c.kind==='diagnostico').flatMap(d=>DIAGNOSIS_INTENSITIES.map(intensity=>({
  diagnosisId:d.id,intensity,availability:'available' as const,rules:recommendations(db,d.id,intensity),
  pending:db.prepare("SELECT id AS ruleId,reason FROM diagnosis_recommendations WHERE diagnosis_id=? AND intensity=? AND status='pending' ORDER BY id").all(d.id,intensity).map(r=>({ruleId:String(r.ruleId),reason:String(r.reason)}))
 })))}
}
// No contacts, plate, customer names, notes, monetary values or other Atendimentos.
// Other scenarios' identities/masks are backend-only: the model sees only the active mask.
export type VoiceModelContextMode='standard'|'omit_recommendations'
// Economic pilot: omit recommendations only from model prompt; trusted planner gets all rules.
export function modelVoiceContext(c:VoicePlanningContext,mode:VoiceModelContextMode='standard'){
 const selected=c.workspace.scenarios.find(s=>s.id===c.workspace.selectedId)!
 return{intensities:DIAGNOSIS_INTENSITIES,
 piecePairs:hierarchyPiecePairs().flatMap(codes=>{const pair=codes.map(code=>c.catalog.find(item=>item.kind==='peca'&&item.code===code&&catalogItemUsable(item)));return pair.every(Boolean)?[pair.map(item=>item!.id)]:[]}),
 catalog:c.catalog.map(i=>({id:i.id,kind:i.kind,name:i.name,code:i.code,side:i.side,serviceId:i.serviceId,usable:catalogItemUsable(i),...(i.kind==='servico'?{policy:servicePolicy(i.id)??null}:{})})),
 pieces:c.workspace.items.map(p=>({id:p.id,pieceId:p.pieceId,diagnosisId:p.diagnosisId,intensity:p.intensity,enabled:Boolean(selected.pieceFlags[p.id]),
  services:p.services.map(l=>({id:l.id,serviceId:l.serviceId,dimensionId:l.dimensionId,quantity:l.quantity,enabled:Boolean(selected.serviceFlags[l.id])}))})),
 ...(mode==='standard'?{recommendations:c.recommendations.map(s=>({diagnosisId:s.diagnosisId,intensity:s.intensity,rules:s.rules.map(r=>({id:r.id,serviceId:r.serviceId,dimensionId:r.dimensionId,selectedByDefault:r.selectedByDefault})),pending:s.pending}))}:{}),
 revisions:{composition:c.workspace.revision,configuration:c.workspace.configurationRevision,scenario:selected.revision}
 }
}
