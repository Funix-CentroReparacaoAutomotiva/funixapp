import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {CiliaApplication,createCiliaApplicationSchema} from '../cilia-application.ts'
import {previewCiliaXml} from '../cilia-review.ts'

const tag=(name:string,value:string)=>'<'+name+'>'+value+'</'+name+'>'
const fields=(v:Record<string,string>)=>Object.entries(v).map(([k,x])=>tag(k,x)).join('')
const g=(k:string,v:string,t:string)=>tag(k,fields({valor:v,tempo:t}))
const section=(name:string,on:boolean)=>tag(name,[
 g('troca_e_remocao_instalacao',on?'100':'0',on?'2':'0'),g('pintura','0','0'),g('reparacao','0','0'),g('funilaria',on?'100':'0',on?'2':'0'),
 ...['vidracaria','tapecaria','eletrica','mecanica'].map(k=>g(k,'0','0')),
 fields({valor_servico_manual:'0',valor_fornecimento_oficina:'0',valor_fornecimento_seguradora:on?'300':'0',valor_total:on?'400':'0'})
].join(''))
const xml=()=>Buffer.from(tag('orcamento',[
 fields({numero_orcamento:'QA-CILIA',versao_orcamento:'1',numero_sinistro:'QA-EVENT',status:'Em orçamentação',nome_da_versao:'Inicial',data_criacao_orcamento:'QA',data_alteracao_status_orcamento:'QA',tipo_do_processo:'Terceiro'}),
 tag('seguradora',fields({nome:'ASSOCIAÇÃO SINTÉTICA',cnpj:'00000000000000'})),tag('veiculo',fields({placa:'ZZZ0Z00',chassi:'SINTETICO',nome_veiculo:'QA',cor:'BRANCA',tipo_pintura:'Comum'})),
 tag('padrao_mao_de_obra',fields({valor_hora_mao_de_obra:'50',valor_hora_reparacao:'40',valor_hora_pintura_tricoat:'80',valor_hora_pintura:'60',majoracao:'0',desconto:'0'})),
 tag('itens_orcamento',tag('item',fields({tipo_item:'Peça',tipo:'Impacto',codigo:'QA',nome:'CAPÔ',troca:'true',remocao_instalacao:'true',pintura:'false',reparacao:'false',inclusao_manual:'true',preco:'300',preco_liquido:'300',percentual_desconto:'0',quantidade:'1',tipo_remocao_instalacao:'Funilaria',hora_remocao_instalacao:'2',hora_reparacao:'',hora_pintura:'',fornecimento:'Associação'}))),
 tag('resumo_geral',section('totais_em_impacto',true)+section('totais_sem_cobertura',false)+section('totais_sob_analise',false)),tag('total_do_orcamento',fields({valor_bruto_pecas:'0',valor_desconto:'0',valor_desconto_pecas_manuais:'0',valor_liquido_mao_de_obra:'100',valor_total_geral:'400',valor_pecas_pela_oficina:'0',valor_franquia:'0',valor_deducao:'0',valor_total_liquido_geral:'100'}))
].join('')))
function setup(){
 const db=openDatabase(':memory:'),f=commercialFixture(db)
 const at=f.atendimentos.create({name:'QA Cilia',plate:'ZZZ0Z00'})
 f.pricing.saveSettings(at.id,{revision:f.pricing.settings(at.id).revision,tableId:'table',colorId:'color',riskId:'risk',mrId:'mr'})
 const catalog=f.commercial.catalogs().items,p=previewCiliaXml(xml(),catalog,'left'),piece=catalog.find(c=>c.code==='capo')!
 const raw={xmlBase64:xml().toString('base64'),steering:'left',attendanceRevision:at.revision,review:{evidenceSha256:p.source.evidenceSha256,scopeReviewed:true,pieces:[{pieceId:piece.id,sourceRowIds:['row-1'],diagnosisId:null,intensity:null,reason:''}],groups:[{operationIds:['row-1:op-1'],options:[{serviceId:f.service.id,dimensionId:f.dimension.id,quantity:'1'}],reason:'Serviço sintético equivalente no ensaio'}]}}
 return {db,f,at,raw,app:new CiliaApplication(db)}
}
function confirmation(x:ReturnType<typeof setup>){
 const p=x.app.preview(x.at.id,x.raw);assert.equal(p.state,'preview')
 if(p.state!=='preview')assert.fail('expected preview')
 return {...x.raw,previewToken:p.previewToken,confirmed:true,identityReviewed:true,scopeReviewed:true,financialReviewed:true,sourceAuthorized:true,externalReviewed:false}
}
test('Cilia opt-in application atomically creates native draft and preserves partner component evidence without billing',()=>{
 const x=setup()
 try{
  assert.throws(()=>x.app.preview(x.at.id,x.raw),{code:'CILIA_WRITE_DISABLED'})
  createCiliaApplicationSchema(x.db)
  const input=confirmation(x);assert.equal(x.f.scenarios.list(x.at.id).length,1)
  assert.throws(()=>x.app.confirm(x.at.id,{...input,sourceAuthorized:false},'qa'),{code:'CILIA_CONFIRMATION_REQUIRED'})
  const saved=x.app.confirm(x.at.id,input,'qa');assert.equal(saved.state,'created')
  const rows=x.app.list(x.at.id);assert.equal(rows.length,1);assert.equal(rows[0]!.partnerComponents.length,1)
  assert.equal(rows[0]!.partnerComponents[0]!.total,'300');assert.ok(rows[0]!.partnerComponents[0]!.nativePieceId)
  assert.deepEqual(x.app.confirm(x.at.id,input,'qa'),{state:'existing',record:saved.record})
  assert.equal(x.f.scenarios.list(x.at.id).length,2)
  assert.equal(x.f.commercial.list(x.at.id,saved.record.scenarioId).length,1)
  assert.equal(x.db.prepare('SELECT count(*) AS n FROM component_items WHERE atendimento_id=?').get(x.at.id)!.n,0)
  assert.equal(x.db.prepare('SELECT count(*) AS n FROM budget_versions').get()!.n,0)
  assert.equal(x.db.prepare('SELECT count(*) AS n FROM work_orders').get()!.n,0)
  const revised=Buffer.from(xml().toString().replace('<versao_orcamento>1','<versao_orcamento>2'))
  const revision=previewCiliaXml(revised,x.f.commercial.catalogs().items,'left').source.evidenceSha256
  assert.throws(()=>x.app.preview(x.at.id,{...x.raw,xmlBase64:revised.toString('base64'),review:{...x.raw.review,evidenceSha256:revision}}),{code:'CILIA_IMPORT_CONFLICT'})
  assert.equal(x.db.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{x.db.close()}
})
test('Cilia rejects stale composition, and rolls back native insert when event receipt fails',()=>{
 const x=setup()
 try{
  createCiliaApplicationSchema(x.db)
  const stale=confirmation(x),s=x.f.scenarios.list(x.at.id)[0]!
  x.f.scenarios.update(x.at.id,s.id,{revision:s.revision,name:'Revisado'})
  assert.throws(()=>x.app.confirm(x.at.id,stale,'qa'),{code:'CILIA_IMPORT_CONFLICT'})
  const input=confirmation(x)
  x.db.exec("CREATE TRIGGER qa_fail_cilia BEFORE INSERT ON cilia_import_events BEGIN SELECT RAISE(ABORT,'QA_ROLLBACK');END;")
  assert.throws(()=>x.app.confirm(x.at.id,input,'qa'),/QA_ROLLBACK/)
  assert.equal(x.f.scenarios.list(x.at.id).length,1);assert.equal(x.f.commercial.list(x.at.id).length,0)
  assert.equal(x.app.list(x.at.id).length,0)
  x.db.exec('DROP TRIGGER qa_fail_cilia')
  assert.equal(x.app.confirm(x.at.id,input,'qa').state,'created')
 }finally{x.db.close()}
})
