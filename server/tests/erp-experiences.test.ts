import assert from 'node:assert/strict'
import test from 'node:test'
import { AtendimentoRepository } from '../atendimentos.ts'
import { openDatabase } from '../database.ts'
import { handleExperiences } from '../erp/experiences.ts'
import { handleWorkshop } from "../erp/workshop.ts"
import { recordConfirmedSalesContact } from "../erp/sales-events.ts"

const instant = Date.parse('2026-11-26T12:00:00Z')
function setup(t: {after(fn:()=>void):void}) {
  const db = openDatabase(':memory:')
  t.after(()=>db.close())
  const repo = new AtendimentoRepository(db)
  const at = repo.create({name:'Inês Sintética',vehicle:'Carro de teste',plate:'SYN1A23',phone:'11911112222'})
  db.prepare(`INSERT INTO production_experiences(id,atendimento_id,customer_json,vehicle_json,payer_json,scheduled_entry,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?)`).run('exp-synthetic',at.id,JSON.stringify({text:'Inês Sintética'}),JSON.stringify({text:'Carro de teste',plate:'SYN1A23'}),
      JSON.stringify({text:'Pagador sintético'}),'2026-11-27T10:00','2026-11-26T12:00:00Z','2026-11-26T12:00:00Z')
  const call = (path:string,body?:unknown,now=instant) => {
    const [route='',search=''] = path.split('?')
    return handleExperiences({db,method:body===undefined?'GET':'POST',path:route,query:new URLSearchParams(search),body,now:()=>now})
  }
  return {db,repo,at,call}
}

test('comentário contextual é a mesma entrada no registro de origem e no Diário',t=>{
  const {db,at,call} = setup(t)
  const content = {
    atendimentoId:at.id,requestId:'synthetic-comment',source:'experiencia',kind:'comment',body:'Comentário da experiência.',
    author:'Operador de teste',attachments:[{name:'evidencia.txt',type:'text/plain',data:'dGVzdGU='}],
  }
  const saved = call('/diario',content)
  assert.deepEqual(call('/diario',content,instant+1000),saved)
  assert.throws(()=>call('/diario',{...content,body:'Outro comentário.'}),{status:409})
  assert.throws(()=>call('/diario',{...content,requestId:'bad-link',relatedId:'other'}),{status:404})
  const diary = call('/diario?atendimentoId='+at.id) as {items:{body:string;relatedId:string;attachments:{name:string}[]}[]}
  assert.equal(diary.items.length,1)
  assert.equal(diary.items[0]?.body,content.body)
  assert.equal(diary.items[0]?.attachments[0]?.name,'evidencia.txt')
  assert.deepEqual(call('/diario?atendimentoId='+at.id+'&source=experiencia&relatedId=exp-synthetic'),diary)
  assert.equal(db.prepare('SELECT count(*) n FROM erp_experience_diary').get()?.n,1)
})

test('SAC cria sequência idempotente, preserva origem vinculada e registra causa e resolução',t=>{
  const {db,repo,at,call} = setup(t)
  const base = {requestId:'sac-synthetic',experienceId:'exp-synthetic',description:'Inspeção de teste solicitada.',author:'Pessoa sintética',origin:'rework',channel:'Balcão'}
  const first = call('/sac',base) as {record:{id:string;followup_atendimento_id:string}}
  assert.deepEqual(call('/sac',base,instant+1000),first)
  assert.throws(()=>call('/sac',{...base,description:'Outro motivo.'}),{status:409})
  const next = first.record.followup_atendimento_id
  assert.equal(repo.get(next).purpose,'commercial')
  assert.equal(repo.get(next).stage,'novo-lead')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM production_experiences').get()?.n,1)
  assert.deepEqual({...((call('/origem?atendimentoId='+next) as {record:object}).record)},{origin:'rework',channel:'Balcão',previous_experience_id:'exp-synthetic'})
  const resolved = {id:first.record.id,cause:'Causa sintética',resolution:'Resolução sintética',author:'Responsável fictício'}
  const receipt = call('/sac/resolver',resolved,instant+1000)
  assert.deepEqual(call('/sac/resolver',resolved,instant+2000),receipt)
  assert.throws(()=>call('/sac/resolver',{...resolved,cause:'Causa nova'}),{status:409})
  const diary = call('/diario?atendimentoId='+at.id+'&source=sac') as {items:{body:string}[]}
  assert.equal(diary.items.length,2)
  assert.match(diary.items[0]!.body,/Causa sintética/)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
})

test('Biblioteca busca por nome com acentos, placa, identificador, origem, período e situação',t=>{
  const {at,call} = setup(t)
  call('/origem',{atendimentoId:at.id,channel:'Balcão'})
  for (const query of ['q=ines','q=SYN-1A23','q=exp-synthetic','origin=initial','from=2026-11-26&to=2026-11-26','status=scheduled']) {
    assert.equal((call('/historico?'+query) as {total:number}).total,1,query)
  }
  for (const query of ['q=outro','origin=rework','from=2026-11-27','status=present']) {
    assert.equal((call('/historico?'+query) as {total:number}).total,0,query)
  }
  assert.throws(()=>call('/historico?from=2026-02-31'),{status:422})
})


test('recorrência pode abrir uma sequência sem registrar reclamação',t=>{
  const {db,call} = setup(t)
  const payload = {requestId:'sequence-synthetic',experienceId:'exp-synthetic',reason:'Retorno solicitado para serviço adicional.',origin:'recurrence',channel:'Balcão'}
  const result = call('/sequencia',payload)
  assert.deepEqual(call('/sequencia',payload),result)
  assert.throws(()=>call('/sequencia',{...payload,origin:'rework'}),{status:409})
  assert.equal(db.prepare('SELECT COUNT(*) n FROM erp_experience_sac').get()?.n,0)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM erp_experience_origin WHERE origin=?').get('recurrence')?.n,1)
})

test('notas legadas ficam consultáveis sem inferir data, autoria ou cópia no Diário',t=>{
  const {db,repo,at,call} = setup(t)
  repo.update(at.id,{revision:at.revision,notes:'Observação legada.'})
  const diary = call('/diario?atendimentoId='+at.id) as {items:unknown[];legacyNotes:{body:string}[]}
  assert.equal(diary.items.length,0)
  assert.equal(diary.legacyNotes[0]?.body,'Observação legada.')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM erp_experience_diary').get()?.n,0)
})

test('Diário reúne eventos confirmados de Vendas e Oficina sem duplicar linhas',t=>{
  const {db,repo,at,call} = setup(t)
  repo.update(at.id,{revision:at.revision,stage:'em-negociacao'})
  const occurred = '2026-11-26T13:00:00.000Z'
  recordConfirmedSalesContact(db,at.id,'synthetic-msg',occurred)
  recordConfirmedSalesContact(db,at.id,'synthetic-msg',occurred)
  const movement = handleWorkshop({
    db,method:'POST',path:'/movement',query:new URLSearchParams(),now:()=>instant,
    body:{experienceId:'exp-synthetic',requestId:'entrance-synthetic',revision:0,action:'entry',operator:'Pessoa sintética'},
  }) as {revision:number}
  handleWorkshop({
    db,method:'POST',path:'/movement',query:new URLSearchParams(),now:()=>instant+1000,
    body:{experienceId:'exp-synthetic',requestId:'obstacle-synthetic',revision:movement.revision,action:'block',note:'Impedimento sintético',operator:'Pessoa sintética'},
  })
  const diary = call('/diario?atendimentoId='+at.id) as {items:{source:string;body:string}[]}
  assert.equal(diary.items.filter(entry=>entry.body.includes('WhatsApp')).length,1)
  assert.equal(diary.items.filter(entry=>entry.body.includes('Em negociação')).length,1)
  assert.equal(diary.items.filter(entry=>entry.source==='oficina').length,2)
  assert.ok(diary.items.some(entry=>entry.body.includes('Impedimento sintético')))
  assert.equal(db.prepare('SELECT COUNT(*) n FROM erp_experience_diary').get()?.n,0)
  assert.equal((call('/historico?status=present') as {total:number}).total,1)
})

test('Atendimento recebido pelo WhatsApp pode ser vinculado sem duplicação e sem perder o canal',t=>{
  const {db,repo,call}=setup(t)
  const next=repo.create({plate:'SYN1A23',acquisitionSource:'whatsapp'})
  db.prepare('UPDATE atendimentos SET created_at=? WHERE id=?').run('2026-11-27T12:00:00Z',next.id)
  const candidates=call('/sequencia/candidatos?atendimentoId='+next.id) as {items:{id:string}[]}
  assert.deepEqual(candidates.items.map(item=>item.id),['exp-synthetic'])
  const payload={atendimentoId:next.id,experienceId:'exp-synthetic',origin:'rework'}
  const link=call('/sequencia/vincular',payload)
  assert.deepEqual(call('/sequencia/vincular',payload),link)
  assert.equal(repo.get(next.id,true).channel,'WhatsApp')
  assert.equal(repo.get(next.id,true).origin,'rework')
  assert.throws(()=>call('/sequencia/vincular',{...payload,origin:'recurrence'}),{status:409})
  const different=repo.create({plate:'SYN2A23',acquisitionSource:'email'})
  assert.equal(repo.get(different.id,true).channel,'Seguradora')
  assert.throws(()=>call('/sequencia/vincular',{...payload,atendimentoId:different.id}),{status:422})
  assert.equal(repo.list().total,3)
  for(const acquisitionSource of ['association','insurer','manual'] as const){
    const newAt=repo.create({acquisitionSource})
    assert.equal(repo.get(newAt.id,true).channel,acquisitionSource==='manual'?'Balcão':'Seguradora')
  }
})
