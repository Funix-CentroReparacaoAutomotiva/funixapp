import {randomUUID} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import {TABLES,sourceId} from './coda-import-source.ts'
import {ServiceError} from './errors.ts'

/** #162: template created atomically with a genuinely new Atendimento only.
 *  Keep the approved canonical Coda IDs. Never infer vehicle size/prices:
 *  the default washing dimension is the expressly approved Coda Lavagem M.
 *  No GET, re-open or retry on an existing Atendimento inserts more rows.
 */
export function initializeVehicleComposition(db:DatabaseSync,atendimentoId:string,createdAt:string){
  const diagnosisId=sourceId(TABLES.diagnoses,'i-UtUmAlS5ma') // Cuidados operacionais (classificação interna)
  const technicalId=sourceId(TABLES.services,'i-GsuErCDZgL') // Avaliação técnica e planejamento (apresentação comercial)
  const washId=sourceId(TABLES.services,'i-AlsNigbGqx') // Lavagem
  const washMId=sourceId(TABLES.dimensions,'i-07mjG2Tryl') // Lavagem / M, ID exato do Coda

  // Development databases without any commercial Coda import keep bootstrap
  // behavior; partially imported Coda catalogs fail closed, never guessed.
  const originCount=Number(db.prepare("SELECT count(*) AS n FROM catalog_items WHERE (kind='servico' OR kind='diagnostico') AND id LIKE 'coda:2zsjI-nqWr:%'").get()!.n)
  if(originCount===0)return
  const expected=[
    {id:diagnosisId,kind:'diagnostico',name:'Cuidados operacionais',serviceId:null},
    {id:technicalId,kind:'servico',name:'Diagnóstico Técnico',serviceId:null},
    {id:washId,kind:'servico',name:'Lavagem',serviceId:null},
    {id:washMId,kind:'dimensao',name:'M',serviceId:washId}
  ]
  const rows=db.prepare('SELECT id,kind,name,active,service_id FROM catalog_items WHERE id IN (?,?,?,?)').all(...expected.map(x=>x.id))
  for(const item of expected){
    const row=rows.find(r=>r.id===item.id)
    if(!row||row.kind!==item.kind||row.active!==1||row.name!==item.name||row.service_id!==item.serviceId)
      throw new ServiceError(409,'DEFAULT_VEHICLE_CATALOG_MISSING','Não foi possível criar o Atendimento: faltam Veículo completo, Cuidados operacionais, Avaliação técnica ou Lavagem M válidos no catálogo. Nenhum Atendimento foi gravado.')
  }
  const vehicle=db.prepare("SELECT id,name,active FROM catalog_items WHERE kind='peca' AND code='veiculo_completo'").get()
  if(!vehicle||vehicle.active!==1)
    throw new ServiceError(409,'DEFAULT_VEHICLE_CATALOG_MISSING','Peça Veículo completo indisponível no catálogo. Nenhum Atendimento foi gravado.')

  // This function is reached only by the create INSERT transaction, never by
  // edits or repeated syncs. The DB unique constraint also guards the piece.
  const itemId=randomUUID()
  db.prepare('INSERT INTO diagnosis_items(id,atendimento_id,piece_id,diagnosis_id,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run(itemId,atendimentoId,vehicle.id,diagnosisId,createdAt,createdAt)
  // Triggers initialize all scenario flags at zero. Only the piece starts on.
  db.prepare('UPDATE scenario_piece_flags SET enabled=1 WHERE piece_id=?').run(itemId)

  const technicalLineId=randomUUID(),washLineId=randomUUID()
  const insert=db.prepare("INSERT INTO diagnosis_services(id,diagnosis_item_id,service_id,dimension_id,quantity,enabled,notes) VALUES(?,?,?,?,?,?,'')")
  insert.run(technicalLineId,itemId,technicalId,null,'1',0)
  insert.run(washLineId,itemId,washId,washMId,'1',1)
  // Scenario flags, not the legacy diagnosis_services.enabled field, control
  // actual pricing, PDF and user-visible selection in every scenario.
  db.prepare('UPDATE scenario_service_flags SET enabled=1 WHERE service_id=?').run(washLineId)
}
