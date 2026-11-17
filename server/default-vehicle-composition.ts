import {randomUUID} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import {TABLES,sourceId} from './coda-import-source.ts'
import {ServiceError} from './errors.ts'

/** #162: create the operational template once, as part of the Atendimento INSERT transaction.
 *  Existing Atendimentos are never backfilled; no event/reload/GET may re-run this.
 *  No financial configuration, billable flag or dimension is inferred.
 */
export function initializeVehicleComposition(db:DatabaseSync,atendimentoId:string,createdAt:string){
  const diagnosisId=sourceId(TABLES.diagnoses,'i-UtUmAlS5ma') // Cuidados operacionais
  const technicalId=sourceId(TABLES.services,'i-GsuErCDZgL') // Diagnóstico Técnico
  const washId=sourceId(TABLES.services,'i-AlsNigbGqx') // Lavagem
  const ids=[diagnosisId,technicalId,washId]
  const catalog=db.prepare('SELECT id,kind,name,active FROM catalog_items WHERE id IN (?,?,?)').all(...ids)
  // Before the first authorized Coda commercial import, preserve the empty
  // development/bootstrap database. A *partially* loaded catalog fails closed.
  const originCount=Number(db.prepare("SELECT count(*) AS n FROM catalog_items WHERE (kind='servico' OR kind='diagnostico') AND id LIKE 'coda:2zsjI-nqWr:%'").get()!.n)
  if(originCount===0)return
  const expected=[
    {id:diagnosisId,kind:'diagnostico',name:'Cuidados operacionais'},
    {id:technicalId,kind:'servico',name:'Diagnóstico Técnico'},
    {id:washId,kind:'servico',name:'Lavagem'}
  ]
  for(const item of expected){
    const row=catalog.find(r=>r.id===item.id)
    if(!row||row.kind!==item.kind||row.active!==1||row.name!==item.name)
      throw new ServiceError(409,'DEFAULT_VEHICLE_CATALOG_MISSING','Não foi possível criar o Atendimento: falta configuração canônica ativa para Veículo, Cuidados operacionais, Diagnóstico Técnico ou Lavagem. Nenhum Atendimento foi gravado.')
  }
  const vehicle=db.prepare("SELECT id,name,active FROM catalog_items WHERE kind='peca' AND code='veiculo_completo'").get()
  if(!vehicle||vehicle.active!==1)
    throw new ServiceError(409,'DEFAULT_VEHICLE_CATALOG_MISSING','Peça Veículo completo indisponível no catálogo. Nenhum Atendimento foi gravado.')
  // The default is inserted only for a genuinely new Atendimento. Never
  // reinsert after an operator explicitly removes or edits the initial piece.
  const itemId=randomUUID()
  db.prepare('INSERT INTO diagnosis_items(id,atendimento_id,piece_id,diagnosis_id,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run(itemId,atendimentoId,vehicle.id,diagnosisId,createdAt,createdAt)
  // Triggers create scenario flags at zero; only the piece starts active.
  db.prepare('UPDATE scenario_piece_flags SET enabled=1 WHERE piece_id=?').run(itemId)
  const insert=db.prepare("INSERT INTO diagnosis_services(id,diagnosis_item_id,service_id,dimension_id,quantity,enabled,notes) VALUES(?,?,?,NULL,'1',0,'')")
  for(const serviceId of [technicalId,washId])insert.run(randomUUID(),itemId,serviceId)
}
