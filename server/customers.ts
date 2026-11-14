import {AtendimentoRepository,normalizePhone} from './atendimentos.ts'
import type {Atendimento} from '../shared/contracts.ts'
import {randomUUID} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import type {CustomerRecord,CustomerReferences,CustomerReference,ReferenceKind} from '../shared/customer.ts'
import {ServiceError} from './errors.ts'
import {inputObject,transaction} from './scenarios.ts'
const invalid=():never=>{throw new ServiceError(400,'INVALID_REFERENCE','Referência inválida.')}
const kinds=['person','contact','vehicle','payer'] as const
export class CustomerRepository {
  readonly db:DatabaseSync
  constructor(db:DatabaseSync){this.db=db}
  available(){return !!this.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='customer_records'").get()}
  record(id:string):CustomerRecord {
    const r=this.db.prepare('SELECT * FROM customer_records WHERE id=?').get(id)
    if(!r)throw new ServiceError(404,'NOT_FOUND','Cadastro não encontrado.')
    return {...JSON.parse(String(r.data)),id:String(r.id),kind:r.kind,revision:Number(r.revision),conversationId:r.conversation_id,entityId:r.entity_id}
  }
  search(kind:string,q:string) {
    if(!['entity','vehicle','contact'].includes(kind)||q.length>150)invalid()
    return this.db.prepare("SELECT id FROM customer_records WHERE kind=? AND data LIKE ? ESCAPE '\\' ORDER BY id LIMIT 20").all(kind,'%'+q.replace(/[\\%_]/g,'\\$&')+'%').map(r=>this.record(String(r.id)))
  }
  validateReference(raw:unknown,kind:ReferenceKind):CustomerReference {
    const r=inputObject(raw,['id','text','plate','fabricationYear','modelYear'])
    if(r.id!==null&&(typeof r.id!=='string'||r.id.length>100))invalid()
    if(typeof r.text!=='string'||r.text.length>250)invalid()
    const result:CustomerReference={id:r.id as string|null,text:String(r.text).trim()}
    if(kind==='vehicle'){
      if(r.plate!==undefined&&(typeof r.plate!=='string'||r.plate.length>100))invalid()
      result.plate=String(r.plate??'').trim().toUpperCase()
      for(const key of ['fabricationYear','modelYear']as const){if(r[key]!==undefined&&r[key]!==null&&(typeof r[key]!=='string'||(r[key]!==''&&!/^(19|20)\d{2}$/.test(String(r[key])))))invalid();result[key]=r[key] as string|null|undefined}
    }
    if(result.id){const found=this.record(result.id);if(found.kind!==(kind==='person'||kind==='payer'?'entity':kind))invalid()}
    return result
  }
  validate(raw:unknown):CustomerReferences {
    const source=inputObject(raw,[...kinds]),result={} as CustomerReferences
    for(const kind of kinds){if(!Array.isArray(source[kind])||source[kind].length>100)invalid();result[kind]=(source[kind] as unknown[]).map(r=>this.validateReference(r,kind))}
    return result
  }
  primaryFields(refs:CustomerReferences,previous?:Atendimento) {
    const value=(kind:ReferenceKind)=>{const r=refs[kind][0];return r?.id?this.record(r.id):r}
    const person=value('person'),contact=value('contact'),vehicle=value('vehicle')
    const old=previous?this.references(previous.id).vehicle[0]:undefined,next=refs.vehicle[0]
    const unchanged=!!previous&&!next?.id&&old?.id===next?.id&&old?.text===next?.text&&(old?.plate??'')===(next?.plate??'')&&(old?.fabricationYear??null)===(next?.fabricationYear??null)&&(old?.modelYear??null)===(next?.modelYear??null)
    const vehicleFields=unchanged?{vehicle:previous.vehicle,model:previous.model,brand:previous.brand,plate:previous.plate,fabricationYear:previous.fabricationYear,modelYear:previous.modelYear}:{vehicle:vehicle?.text??'',model:vehicle?.text??'',brand:'',plate:vehicle?.plate??'',fabricationYear:vehicle?.fabricationYear??null,modelYear:vehicle?.modelYear??null}
    return {name:person?.text??'',phone:contact?.text??'',...vehicleFields}
  }
  saveReferences(at:string,refs:CustomerReferences) {
    this.db.prepare('DELETE FROM atendimento_references WHERE atendimento_id=?').run(at)
    for(const kind of kinds)refs[kind].forEach((r,i)=>{
      this.db.prepare('INSERT INTO atendimento_references VALUES(?,?,?,?,?)').run(at,kind,i,r.id,JSON.stringify(r))
      // Selecting a known channel Contact is explicit; a textual phone match never reaches here.
      const cid=kind==='contact'&&r.id?this.record(r.id).conversationId:null
      if(cid&&!this.db.prepare('SELECT 1 FROM v20_associations WHERE conversation_id=? AND atendimento_id=? AND unlinked_at IS NULL').get(cid,at)){
        this.db.prepare('INSERT INTO v20_associations(id,conversation_id,atendimento_id,linked_at,linked_by,link_reason) VALUES(?,?,?,?,?,?)').run(randomUUID(),cid,at,new Date().toISOString(),'operator','explicit_contact_reference')
        this.db.prepare('UPDATE v20_conversations SET revision=revision+1 WHERE id=?').run(cid)
      }
    })
  }
  references(at:string):CustomerReferences {
    const row=this.db.prepare('SELECT * FROM atendimentos WHERE id=?').get(at)!
    const refs:CustomerReferences={person:[{id:null,text:String(row.name)}],contact:[{id:null,text:String(row.phone)}],vehicle:[{id:null,text:String(row.vehicle),plate:String(row.plate),fabricationYear:row.fabrication_year as string|null,modelYear:row.model_year as string|null}],payer:[]}
    const stored=this.db.prepare('SELECT * FROM atendimento_references WHERE atendimento_id=? ORDER BY position').all(at)
    for(const kind of kinds){const rows=stored.filter(r=>r.kind===kind);if(rows.length)refs[kind]=rows.map(r=>{const data=JSON.parse(String(r.data));if(!r.record_id)return data;const found=this.record(String(r.record_id));return {id:found.id,text:found.text,...(kind==='vehicle'?{plate:found.plate,fabricationYear:found.fabricationYear,modelYear:found.modelYear}:{})}})}
    return refs
  }
  present(items:Atendimento[]):Atendimento[] {
    if(!items.length)return items
    const rows=this.db.prepare(`SELECT r.atendimento_id,r.kind,r.data,c.data AS record FROM atendimento_references r LEFT JOIN customer_records c ON c.id=r.record_id WHERE r.position=0 AND r.atendimento_id IN (${items.map(()=>'?').join(',')})`).all(...items.map(i=>i.id))
    return items.map(item=>{const out={...item};for(const row of rows.filter(r=>r.atendimento_id===item.id)){const r=JSON.parse(String(row.record??row.data));if(row.kind==='person')out.name=String(r.text??'');if(row.kind==='contact')out.phone=String(r.text??'');if(row.kind==='vehicle'){out.vehicle=String(r.text??'');out.plate=String(r.plate??'');out.fabricationYear=r.fabricationYear??null;out.modelYear=r.modelYear??null}}out.phoneNormalized=normalizePhone(out.phone);return out})
  }
  applyLegacyFields(at:string,fields:Record<string,string|boolean|number|null>) {
    for(const [kind,key]of [['person','name'],['contact','phone'],['vehicle','vehicle']]as const){
      if(fields[key]===undefined&&!(kind==='vehicle'&&['plate','fabricationYear','modelYear'].some(k=>fields[k]!==undefined)))continue
      const row=this.db.prepare('SELECT data,record_id FROM atendimento_references WHERE atendimento_id=? AND kind=? AND position=0').get(at,kind)
      if(!row)continue
      const r=row.record_id?this.record(String(row.record_id)):JSON.parse(String(row.data))
      // Explicit textual correction detaches this ficha reference, never moves messages or edits a shared record.
      const data={id:null,text:fields[key]??r.text,...(kind==='vehicle'?{plate:fields.plate??r.plate??'',fabricationYear:fields.fabricationYear??r.fabricationYear??null,modelYear:fields.modelYear??r.modelYear??null}:{})}
      this.db.prepare('UPDATE atendimento_references SET record_id=NULL,data=? WHERE atendimento_id=? AND kind=? AND position=0').run(JSON.stringify(data),at,kind)
    }
  }
  save(raw:unknown,id?:string) {
    const source=inputObject(raw,['kind','text','plate','fabricationYear','modelYear','revision','nickname','entityId'])
    const old=id?this.record(id):null,kind=old?.kind??source.kind
    if(!['entity','contact','vehicle'].includes(String(kind)))invalid()
    const ref=this.validateReference({id:null,text:source.text, ...(kind==='vehicle'?{plate:source.plate,fabricationYear:source.fabricationYear,modelYear:source.modelYear}:{})},kind==='entity'?'person':kind as ReferenceKind)
    if(!ref.text.trim()&&!(kind==='contact'&&old?.conversationId))invalid()
    if(source.nickname!==undefined&&(kind!=='contact'||typeof source.nickname!=='string'||source.nickname.length>250))invalid()
    const entityId=source.entityId===undefined?old?.entityId??null:source.entityId
    if(entityId!==null&&(typeof entityId!=='string'||this.record(entityId).kind!=='entity'))invalid()
    if(old?.conversationId&&old.text!==ref.text)throw new ServiceError(409,'CONTACT_HISTORY_PROTECTED','Contato com histórico: use outra referência para informar outro telefone.')
    return transaction(this.db,()=>{
      const key=id??randomUUID(),data=JSON.stringify({...ref,nickname:source.nickname??(old as CustomerRecord&{nickname?:string})?.nickname??'',channelState:old?.channelState??'informed'})
      if(old){if(source.revision!==old.revision)throw new ServiceError(409,'VERSION_CONFLICT','Cadastro alterado em outra edição.');const changed=this.db.prepare('UPDATE customer_records SET data=?,entity_id=?,revision=revision+1 WHERE id=? AND revision=?').run(data,entityId as string|null,key,old.revision);if(!changed.changes)invalid()}
      else this.db.prepare('INSERT INTO customer_records(id,kind,data,entity_id) VALUES(?,?,?,?)').run(key,String(kind),data,entityId as string|null)
      for(const affected of this.db.prepare('SELECT DISTINCT atendimento_id FROM atendimento_references WHERE record_id=?').all(key)){
        const record=this.present([new AtendimentoRepository(this.db).get(String(affected.atendimento_id))])[0]!
        const search=[record.id,record.phone,record.name,record.vehicle,record.brand,record.model,record.plate].join('\n').normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR')
        this.db.prepare('UPDATE atendimentos SET search_text=? WHERE id=?').run(search,record.id)
      }
      return this.record(key)
    })
  }
}
