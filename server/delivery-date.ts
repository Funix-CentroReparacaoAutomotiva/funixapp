import type {DatabaseSync} from 'node:sqlite'
import {validDeliveryDate} from '../shared/delivery-date.ts'
import {ServiceError} from './errors.ts'

export function parseDeliveryDate(value:unknown):string|null{
  if(value===null||value==='')return null
  if(!validDeliveryDate(value))throw new ServiceError(422,'INVALID_DELIVERY_DATE','Informe uma data de entrega válida.')
  return value
}
export function deliveryReason(value:unknown,fallback:string):string{
  if(value===undefined||value==='')return fallback
  if(typeof value!=='string'||value.trim().length<5||value.trim().length>500)
    throw new ServiceError(422,'INVALID_DELIVERY_REASON','Informe um motivo de 5 a 500 caracteres.')
  return value.trim()
}
/** Caller owns the SQLite transaction and optimistic revision checks. */
export function writeDeliveryDate(db:DatabaseSync,at:string,before:string|null,after:string|null,reason:string,now:string,bumpRevision:boolean){
  if(before===after)return
  const changed=db.prepare(bumpRevision?'UPDATE atendimentos SET delivery_date=?,updated_at=?,revision=revision+1 WHERE id=?':'UPDATE atendimentos SET delivery_date=? WHERE id=?').run(after,...(bumpRevision?[now,at]:[at]))
  if(!changed.changes)throw new ServiceError(404,'NOT_FOUND','Atendimento não encontrado.')
  db.prepare('INSERT INTO atendimento_delivery_date_history(atendimento_id,previous_date,new_date,reason,changed_at,operator_id) VALUES(?,?,?,?,?,NULL)').run(at,before,after,reason,now)
}
