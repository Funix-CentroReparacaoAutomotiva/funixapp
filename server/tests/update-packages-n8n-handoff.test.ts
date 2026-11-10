import test from 'node:test'
import assert from 'node:assert/strict'
import {Readable} from 'node:stream'
import type {IncomingMessage,ServerResponse} from 'node:http'
import {openDatabase} from '../database.ts'
import {createUpdatePackageSchema} from '../update-packages-schema.ts'
import {UpdatePackageRepository} from '../update-packages.ts'
import {createUpdatePackageIngest} from '../update-packages-ingest.ts'
import {prepareSignedPendingGmailRequest} from '../update-packages-n8n-handoff.ts'

const secret='local-fixture-only-secret-01234567890123456789'
const now=1794172800000
const id='abcdef0123456789'
function draft(){
 const base={source:'gmail',sourceReference:id,experienceId:'XP1234',plate:'ABC1D23'}
 const photo={id:'drive:'+'a'.repeat(32),type:'drive_archive',title:'Arquivar foto.jpg',
   detail:'Origem Gmail '+id+'; revalidar arquivo e destino antes de gravar.'}
 const review={id:'review:identity',type:'other',title:'Revisar vínculo da XP',
   detail:'A correspondência textual não constitui autorização de trabalho.'}
 const pending={key:'commercialReview',label:'Validar informações comerciais',
   hint:'Conferir mensagem integral, emissor, autorização, valores e escopo na fonte oficial.'}
 return {
  status:'PACOTE_UNICO_RASCUNHO_NAO_PUBLICADO',
  send_enabled:false,upload_permitted:false,
  readiness:'AGUARDANDO_REVALIDACAO_E_APROVACAO_HUMANA',
  eventKey:'gmail:'+id+':v1',
  inventory:{eventKey:'gmail:'+id+':v1',source:'gmail',sourceReference:id,
   bodyReviewed:false,commercialReviewed:false,attachmentIds:['attachment_0'],checkedAttachmentIds:[]},
  eventManifest:{eventKey:'gmail:'+id+':v1',expectedParts:['identity','documents','commercial']},
  fragments:[
   {part:'identity',proposal:{...base,title:'Conferir identidade',
     summary:'XP/placa associadas ao Coda; verificar contra origem.',actions:[review],missingFields:[]}},
   {part:'documents',proposal:{...base,title:'Documentos',
     summary:'1 novo(s) arquivo(s) proposto(s)',actions:[photo],missingFields:[]}},
   {part:'commercial',proposal:{...base,title:'Dados comerciais',
     summary:'Conferência de autorização e condições comerciais obrigatória.',
     actions:[],missingFields:[pending]}}
  ],
  proposal:{...base,title:'XP1234 · ABC1D23',
   summary:'1 novos originais; validação comercial pendente.',
   actions:[review,photo],missingFields:[pending]}
 }
}
function request(body:string,headers:Record<string,string>):IncomingMessage{
 return Object.assign(Readable.from([body]),{
  method:'POST',headers:{
   'content-type':headers['Content-Type'],
   'x-funix-updates-timestamp':headers['X-Funix-Updates-Timestamp'],
   'x-funix-updates-signature':headers['X-Funix-Updates-Signature']
  }
 }) as unknown as IncomingMessage
}
test('n8n sintético → validação → HMAC → ingestão → card aberto bloqueado, sem executor',async()=>{
 const db=openDatabase(':memory:')
 try{
  createUpdatePackageSchema(db)
  const repo=new UpdatePackageRepository(db)
  const signed=prepareSignedPendingGmailRequest(draft(),secret,now)
  const receiver=createUpdatePackageIngest(repo,secret,true,()=>now)
  const res={setHeader:()=>{}} as unknown as ServerResponse
  const first=await receiver(request(signed.body,signed.headers),res)
  assert.equal(first.status,'awaiting_review')
  assert.equal(repo.list('open','XP1234').total,1)
  const pkg=repo.get(first.packageId)
  assert.ok(pkg.missingFields.some(f=>f.key==='commercialReview'))
  assert.deepEqual(pkg.actions.map(a=>a.type),['other','drive_archive'])
  assert.throws(()=>repo.decide(pkg.id,{decision:'approve',revision:pkg.revision,
   snapshotHash:pkg.snapshotHash,requestId:'11111111-1111-4111-8111-111111111111'},
   'synthetic_operator'),/pendentes/)
  const repeat=await receiver(request(signed.body,signed.headers),res)
  assert.equal(repeat.packageId,first.packageId)
  assert.equal(repo.list('open','XP1234').total,1)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM update_packages WHERE status='executed'").get()!.n,0)
 }finally{db.close()}
})
test('adulteração de rascunho impede a assinatura ou bloqueia a recepção',async()=>{
 const changed=draft()
 changed.proposal.missingFields=[]
 assert.throws(()=>prepareSignedPendingGmailRequest(changed,secret,now),/N8N_DRAFT_PROPOSAL_MISMATCH/)
 const fake=draft()
 fake.inventory.commercialReviewed=true
 assert.throws(()=>prepareSignedPendingGmailRequest(fake,secret,now),/N8N_DRAFT_INVENTORY_INVALID/)
 const signed=prepareSignedPendingGmailRequest(draft(),secret,now)
 const db=openDatabase(':memory:')
 try{
  createUpdatePackageSchema(db)
  const repo=new UpdatePackageRepository(db)
  const receiver=createUpdatePackageIngest(repo,secret,true,()=>now)
  await assert.rejects(()=>receiver(request(signed.body.replace('XP1234','XP9999'),signed.headers),
    {setHeader:()=>{}} as unknown as ServerResponse),/Assinatura inválida/)
  assert.equal(repo.list('open','').total,0)
 }finally{db.close()}
})
