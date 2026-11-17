import {randomUUID} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import {TABLES,sourceId} from './coda-import-source.ts'
import {ServiceError} from './errors.ts'

export const VEHICLE_CODE='veiculo_completo'
const diagnosisId=sourceId(TABLES.diagnoses,'i-UtUmAlS5ma')
const technicalId=sourceId(TABLES.services,'i-GsuErCDZgL')
const washId=sourceId(TABLES.services,'i-AlsNigbGqx')
const washMId=sourceId(TABLES.dimensions,'i-07mjG2Tryl')
export const requiredVehicleCatalog=[
 {id:diagnosisId,kind:'diagnostico',name:'Cuidados operacionais',serviceId:null},
 {id:technicalId,kind:'servico',name:'Diagnóstico Técnico',serviceId:null},
 {id:washId,kind:'servico',name:'Lavagem',serviceId:null},
 {id:washMId,kind:'dimensao',name:'M',serviceId:washId}
] as const

// An explicit catalog installation enables the template. Old databases and
// synthetic fixtures without the new piece keep their previous behavior.
export function vehicleCatalogProblems(db:DatabaseSync):string[]{
 const rows=db.prepare('SELECT id,kind,name,active,service_id FROM catalog_items WHERE id IN (?,?,?,?)').all(...requiredVehicleCatalog.map(x=>x.id))
 return requiredVehicleCatalog.flatMap(item=>{
  const row=rows.find(r=>r.id===item.id)
  return row&&row.kind===item.kind&&row.active===1&&row.name===item.name&&row.service_id===item.serviceId?[]:[item.name+' ('+item.id+')']
 })
}

/** #162: runs only inside the transaction creating a new Atendimento. */
export function initializeVehicleComposition(db:DatabaseSync,atendimentoId:string,createdAt:string){
 if(!db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='scenario_service_flags'").get())return
 const vehicle=db.prepare("SELECT id,active FROM catalog_items WHERE kind='peca' AND code=?").get(VEHICLE_CODE)
 if(!vehicle)return
 const problems=vehicleCatalogProblems(db)
 if(vehicle.active!==1||problems.length)
  throw new ServiceError(409,'DEFAULT_VEHICLE_CATALOG_MISSING','Cadastro inicial de Veículo completo indisponível: conferir peça, Cuidados operacionais, Avaliação técnica e Lavagem M. Nenhum Atendimento foi gravado.')
 const scenario=db.prepare('SELECT id FROM scenarios WHERE atendimento_id=? ORDER BY position,id').all(atendimentoId)
 if(scenario.length!==1)throw new Error('O padrão inicial exige exatamente um cenário na criação.')
 const itemId=randomUUID()
 db.prepare('INSERT INTO diagnosis_items(id,atendimento_id,piece_id,diagnosis_id,created_at,updated_at) VALUES(?,?,?,?,?,?)')
   .run(itemId,atendimentoId,vehicle.id,diagnosisId,createdAt,createdAt)
 db.prepare('UPDATE scenario_piece_flags SET enabled=1 WHERE piece_id=? AND scenario_id=?').run(itemId,scenario[0]!.id)
 const technicalLineId=randomUUID(),washLineId=randomUUID()
 const insert=db.prepare("INSERT INTO diagnosis_services(id,diagnosis_item_id,service_id,dimension_id,quantity,enabled,notes) VALUES(?,?,?,?,?,?,'')")
 insert.run(technicalLineId,itemId,technicalId,null,'1',0)
 insert.run(washLineId,itemId,washId,washMId,'1',1)
 db.prepare('UPDATE scenario_service_flags SET enabled=1 WHERE service_id=? AND scenario_id=?').run(washLineId,scenario[0]!.id)
}
