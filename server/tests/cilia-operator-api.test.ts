import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {readCiliaUpload} from '../cilia-operator-api.ts'
import {createApp} from '../app.ts'
import {openDatabase} from '../database.ts'
import {AtendimentoRepository} from '../atendimentos.ts'

test('Cilia upload requires canonical bounded bytes and explicit steering',()=>{
 const xmlBase64=Buffer.from('<orcamento/>').toString('base64')
 assert.equal(readCiliaUpload({xmlBase64,steering:'left'}).bytes.toString(),'<orcamento/>')
 for(const raw of [null,{xmlBase64,steering:'auto'},{xmlBase64,steering:'left',total:'0'},{xmlBase64:xmlBase64+'=',steering:'left'},{xmlBase64:'A'.repeat(699056),steering:'left'}])assert.throws(()=>readCiliaUpload(raw),{code:'CILIA_UPLOAD_INVALID'})
})
test('Cilia operator route is gated by session, feature, origin, and has no write action',async()=>{
 const db=openDatabase(':memory:'),atendimentos=new AtendimentoRepository(db),at=atendimentos.create({name:'QA Cilia',plate:'ZZZ0Z00'})
 try{
  for(const enabled of [false,true]){
   const app=createApp({atendimentos,password:'synthetic-password',voiceProvider:null,ciliaPreviewEnabled:enabled})
   app.listen(0,'127.0.0.1');await once(app,'listening')
   try{
    const addr=app.address();assert.ok(addr&&typeof addr==='object')
    const base='http://127.0.0.1:'+addr.port,url=base+'/api/atendimentos/'+at.id+'/importar-cilia'
    const origin='http://127.0.0.1:5173'
    assert.equal((await fetch(url)).status,401)
    const login=await fetch(base+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'synthetic-password'})})
    assert.equal(login.status,200)
    const cookie=login.headers.get('set-cookie')!.split(';')[0]!
    await login.text()
    assert.deepEqual(await (await fetch(url,{headers:{Cookie:cookie}})).json(),{enabled,writeEnabled:false,historyEnabled:false})
    const post=(data:unknown,from=origin,method='POST')=>fetch(url,{method,headers:{Cookie:cookie,Origin:from,'Content-Type':'application/json'},body:JSON.stringify(data)})
    const malformed={xmlBase64:Buffer.from('<orcamento/>').toString('base64'),steering:'left'}
    assert.equal((await post(malformed)).status,enabled?422:503)
    assert.equal((await post(malformed,'https://example.invalid')).status,enabled?403:503)
    assert.equal((await post(malformed,origin,'PUT')).status,405)
    assert.equal(db.prepare('SELECT count(*) AS n FROM budget_versions').get()!.n,0)
    assert.equal(db.prepare('SELECT count(*) AS n FROM component_items').get()!.n,0)
   }finally{await new Promise<void>(resolve=>app.close(()=>resolve()))}
  }
 }finally{db.close()}
})
