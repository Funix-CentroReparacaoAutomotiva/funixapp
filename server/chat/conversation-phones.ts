import type {DatabaseSync} from 'node:sqlite'
import {AtendimentoRepository} from '../atendimentos.ts'

/** Commercial presentation only. Never WhatsApp evidence, recipient or authorization. */
export function atendimentoDisplayPhone(db:DatabaseSync,atendimentoId:string|null):string|null {
 if(!atendimentoId)return null
 const normalized=new AtendimentoRepository(db).get(atendimentoId,true).phoneNormalized
 return normalized&&/^\+[1-9]\d{7,14}$/.test(normalized)?normalized.slice(1):null
}
