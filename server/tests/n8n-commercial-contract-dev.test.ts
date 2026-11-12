import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'

type Item={json:Record<string,any>}
const fixture=JSON.parse(readFileSync(new URL('./fixtures/n8n-comercial-draft.json',import.meta.url),'utf8')) as {
  workflowId:string;draftVersion:string;code:Record<string,string>;codaQueries:Record<string,string>
}
const JID='5531999990001@s.whatsapp.net'
const OTHER='5531888880000@s.whatsapp.net'
const event='evo:funix_comercial:SYNTH_001'
const cid='i-CANONICAL_01'
const source={
  whatsappJid:JID,fx_UUID:event,instancia:'funix_comercial',occurredAt:1794144000,
  telefoneE164:'+5531999990001',nome:'Cliente sintético',
}
const coda=(overrides:Record<string,unknown>={})=>({
  id:cid,fx_UUID:'evo:funix_comercial:ORIGINAL_001',
  'api_ID Omnichanel':JID,funil_Canal:{rowId:'i-O01Tgl0bN2'},
  funil_contatoE164:source.telefoneE164,at_StatusComercial:'Em Negociação (48h)',
  ...overrides,
})
function execute(name:string, input:unknown[], refs:Record<string,Item>, ms=1794145000000):Item[] {
  const code=fixture.code[name]
  if(!code)throw Error('N8N_FIXTURE_MISSING_NODE:'+name)
  const context={
    $input:{
      first:()=>({json:input[0]??{}}),
      all:()=>input.map(json=>({json})),
    },
    $:(node:string)=>({
      first:()=>{
        if(!refs[node])throw Error('N8N_FIXTURE_MISSING_REF:'+node)
        return refs[node]
      },
    }),
    Date:class extends Date{static now(){return ms}},
  }
  return runInNewContext('(function(){\n'+code+'\n})()',context,{timeout:1000}) as Item[]
}
const refs=(decision?:Record<string,any>, link?:Record<string,any>)=>{
  const output:Record<string,Item>={
    'Code in JavaScript':{json:source},
    'Verificar opção Não gerar lead':{json:{naoGerarLead:false}},
  }
  if(decision)output['Code in JavaScript1']={json:decision}
  if(link)output['Evento | Validar vínculo (RASCUNHO sem envio)']={json:link}
  return output
}
const classify=(rows:Record<string,unknown>[])=>execute('Code in JavaScript1',rows,refs())[0]!.json

test('DEV n8n draft snapshot: normalized original Evolution message identity and timestamp',()=>{
  const body={event:'messages.upsert',instance:'funix_comercial',data:{
    key:{fromMe:false,id:'SYNTH_001',remoteJid:JID},
    pushName:'Cliente sintético',messageTimestamp:1794144000,
    message:{conversation:'Olá!'},
  }}
  const x=execute('Code in JavaScript',[body],{})[0]!.json
  assert.equal(x.fx_UUID,event)
  assert.equal(x.whatsappJid,JID)
  assert.equal(x.occurredAt,1794144000)
  assert.equal(x.tipoAtendimento,'Lead')
  assert.equal(x.telefoneE164,source.telefoneE164)
  const missingTimestamp={...body,data:{...body.data,messageTimestamp:undefined}}
  assert.equal(execute('Code in JavaScript',[missingTimestamp],{})[0]!.json.occurredAt,null)
  for(const invalid of [null,'',false,0,'not-a-timestamp']) {
    const testBody={...body,data:{...body.data,messageTimestamp:invalid}}
    assert.equal(execute('Code in JavaScript',[testBody],{})[0]!.json.occurredAt,null)
  }
  for(const valid of [1794144000,'1794144000']) {
    const testBody={...body,data:{...body.data,messageTimestamp:valid}}
    assert.equal(execute('Code in JavaScript',[testBody],{})[0]!.json.occurredAt,1794144000)
  }
  assert.equal(execute('Code in JavaScript',[{...body,data:{...body.data,key:{...body.data.key,fromMe:true}}}],{}).length,0)
})
test('DEV n8n draft: other WhatsApp customers do not block this JID',()=>{
  const another=coda({id:'i-OTHER_01',fx_UUID:'evo:funix_comercial:OTHER_ORIGIN',
    'api_ID Omnichanel':OTHER,funil_Canal:{rowId:'i-NON_WHATSAPP'}})
  const d=classify([another])
  assert.equal(d.motivo,'Contato novo')
  assert.equal(d.criarCard,true)
})
test('DEV n8n draft: manually created Coda record with same phone is never reused as WhatsApp origin',()=>{
  const manual=coda({id:'i-MANUAL_01',fx_UUID:'',funil_Canal:{rowId:'i-O01Tgl0bN2'}})
  const d=classify([manual])
  assert.equal(d.atendimentosEncontrados,0)
  assert.equal(d.criarCard,true)
})
test('DEV n8n draft: same JID invalid channel, multiple open records and replay fail closed',()=>{
  const wrong=coda({funil_Canal:{rowId:'i-WRONG'}})
  assert.equal(classify([wrong]).motivo,'Origem WhatsApp inconsistente')
  assert.equal(classify([wrong]).criarCard,false)
  const second=coda({id:'i-CANONICAL_02',fx_UUID:'evo:funix_comercial:ORIGINAL_002'})
  assert.equal(classify([coda(),second]).motivo,'Múltiplos Atendimentos comerciais elegíveis')
  assert.equal(classify([coda(),second]).criarCard,false)
  const duplicate=coda({fx_UUID:event})
  assert.equal(classify([duplicate]).motivo,'Evento já registrado')
  assert.equal(classify([duplicate]).criarCard,false)
})
test('DEV n8n draft: source/decision prepare immutable UTF-8 body and correct separated HMAC domains',()=>{
  const origin=execute('DEV | Fonte WhatsApp | Preparar',[],refs())[0]!.json
  assert.equal(origin.timestamp,'1794145000')
  const body=JSON.parse(origin.bodyJson)
  assert.deepEqual(Object.keys(body),[
    'eventId','remoteJid','phoneE164','displayName','occurredAt','instance','source','suppressed',
  ])
  assert.equal(body.eventId,event)
  assert.equal(body.suppressed,false)
  assert.equal(body.occurredAt,source.occurredAt)
  assert.equal(origin.signatureInput,'whatsapp-source-v1\n'+origin.timestamp+'\n'+origin.bodyJson)
  const d=classify([coda()])
  const verified=execute('Evento | Validar vínculo (RASCUNHO sem envio)',[coda()],refs(d))[0]!.json
  assert.equal(verified.codaRowId,cid)
  assert.equal(JSON.parse(verified.bodyJson).eventId,event)
  const decision=execute('DEV | Decisão Coda | Preparar',[],refs(d,verified))[0]!.json
  assert.equal(decision.signatureInput,'whatsapp-decision-v1\n'+decision.timestamp+'\n'+decision.bodyJson)
  assert.deepEqual(JSON.parse(decision.bodyJson),{eventId:event,codaRowId:cid,remoteJid:JID})
  const key=Buffer.alloc(32,31)
  assert.notEqual(
    createHmac('sha256',key).update(origin.signatureInput).digest('hex'),
    createHmac('sha256',key).update(decision.signatureInput).digest('hex'),
  )
})
test('DEV n8n draft: blocked opt-out and ambiguous Coda rows prevent source and decision emission',()=>{
  const r=refs()
  r['Verificar opção Não gerar lead']={json:{naoGerarLead:true}}
  assert.equal(execute('DEV | Fonte WhatsApp | Preparar',[],r).length,0)
  const d=classify([coda(),coda({id:'i-CANONICAL_02',fx_UUID:'evo:funix_comercial:ORIGINAL_002'})])
  assert.equal(execute('Evento | Validar vínculo (RASCUNHO sem envio)',[coda()],refs(d)).length,0)
  assert.equal(execute('DEV | Decisão Coda | Preparar',[],refs(d,{status:'not-ready'})).length,0)
})

test('DEV n8n draft: initial and confirmed Coda queries use the exact WhatsApp JID',()=>{
  for(const name of ['Get all rows','Coda | Confirmar linha canônica (RASCUNHO)']){
    const query=fixture.codaQueries[name]
    assert.ok(query,'Expected Coda query for '+name)
    assert.match(query,/api_ID Omnichanel/)
    assert.match(query,/whatsappJid/)
    assert.doesNotMatch(query,/funil_contatoE164|telefoneE164/)
  }
})
