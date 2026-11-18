import test from 'node:test'
import assert from 'node:assert/strict'
import {previewCiliaXml,assembleCiliaReviewedScope} from '../cilia-review.ts'
import type {CiliaScopeReview} from '../cilia-review.ts'

const tag=(name:string,value:string)=>'<'+name+'>'+value+'</'+name+'>'
const fields=(v:Record<string,string>)=>Object.entries(v).map(([k,x])=>tag(k,x)).join('')
const item=(patch:Record<string,string>={})=>tag('item',fields({tipo_item:'Peça',tipo:'Impacto',codigo:'QA',nome:'CAPÔ',troca:'true',remocao_instalacao:'true',pintura:'true',reparacao:'false',inclusao_manual:'true',preco:'300',preco_liquido:'300',percentual_desconto:'0',quantidade:'1',tipo_remocao_instalacao:'Funilaria',hora_remocao_instalacao:'1',hora_reparacao:'',hora_pintura:'2',fornecimento:'Associação',...patch}))
const group=(k:string,v:string,t:string)=>tag(k,fields({valor:v,tempo:t}))
const section=(name:string,on:boolean)=>tag(name,[group('troca_e_remocao_instalacao',on?'85':'0',on?'1.7':'0'),group('pintura',on?'120':'0',on?'2':'0'),group('reparacao','0','0'),group('funilaria',on?'85':'0',on?'1.7':'0'),...['vidracaria','tapecaria','eletrica','mecanica'].map(k=>group(k,'0','0')),fields({valor_servico_manual:on?'10':'0',valor_fornecimento_oficina:on?'70':'0',valor_fornecimento_seguradora:on?'320':'0',valor_total:on?'605':'0'})].join(''))
const xml=()=>Buffer.from(tag('orcamento',[
 fields({numero_orcamento:'QA',versao_orcamento:'1',numero_sinistro:'QA-EVENT',status:'Em orçamentação',nome_da_versao:'Inicial',data_criacao_orcamento:'QA',data_alteracao_status_orcamento:'QA',tipo_do_processo:'Terceiro'}),
 tag('seguradora',fields({nome:'ASSOCIAÇÃO SINTÉTICA',cnpj:'00000000000000'})),tag('veiculo',fields({placa:'ZZZ0Z00',chassi:'SINTETICO',nome_veiculo:'QA',cor:'BRANCA',tipo_pintura:'Comum'})),
 tag('padrao_mao_de_obra',fields({valor_hora_mao_de_obra:'50',valor_hora_reparacao:'40',valor_hora_pintura_tricoat:'80',valor_hora_pintura:'60',majoracao:'0',desconto:'0'})),
 tag('itens_orcamento',item()+item({nome:'DOBRADIÇA DIR DO CAPÔ',pintura:'false',hora_pintura:'',hora_remocao_instalacao:'0.2',preco:'20',preco_liquido:'20'})+item({nome:'FAROL DIREITO',pintura:'false',hora_pintura:'',hora_remocao_instalacao:'0.5',preco:'70',preco_liquido:'70',fornecimento:'Oficina'})+item({tipo_item:'Serviço',nome:'REM E INST CONJUNTO MOTRIZ',troca:'false',remocao_instalacao:'false',pintura:'false',hora_remocao_instalacao:'',hora_pintura:'',tipo_remocao_instalacao:'',preco:'10',preco_liquido:'10',fornecimento:'Oficina'})),
 tag('resumo_geral',section('totais_em_impacto',true)+section('totais_sem_cobertura',false)+section('totais_sob_analise',false)),tag('total_do_orcamento',fields({valor_bruto_pecas:'70',valor_desconto:'0',valor_desconto_pecas_manuais:'0',valor_liquido_mao_de_obra:'215',valor_total_geral:'605',valor_pecas_pela_oficina:'70',valor_franquia:'0',valor_deducao:'0',valor_total_liquido_geral:'285'}))
].join('')))
const prefix='coda:2zsjI-nqWr:grid-lhdFxol6x-:'
const montage=prefix+'i-vmJ3Org23i',paint=prefix+'i-XDTMBmueos',mechanics=prefix+'i-RoaRcVLUCo'
const piece=(id:string)=>({id,kind:'peca',code:id,name:id,active:true,serviceId:null})
const service=(id:string)=>({id,kind:'servico',code:null,name:id,active:true,serviceId:null})
const dimension=(id:string,serviceId:string)=>({id,kind:'dimensao',code:null,name:id,active:true,serviceId})
const catalog=[piece('capo'),piece('farol__passageiro'),piece('veiculo_completo'),service(montage),service(paint),service(mechanics),dimension('mont-p',montage),dimension('paint-full',paint),dimension('mech-p',mechanics)]
const preview=()=>previewCiliaXml(xml(),catalog,'left')
const scope=():CiliaScopeReview=>({evidenceSha256:preview().source.evidenceSha256,scopeReviewed:true,pieces:[{pieceId:'capo',sourceRowIds:['row-1','row-2'],diagnosisId:null,intensity:null,reason:'Hipótese sintética de conjunto'},{pieceId:'farol__passageiro',sourceRowIds:['row-3'],diagnosisId:null,intensity:null,reason:''},{pieceId:'veiculo_completo',sourceRowIds:['row-4'],diagnosisId:null,intensity:null,reason:'Identidade revisada no exemplo'}],groups:[{operationIds:['row-1:op-1','row-2:op-1'],options:[{serviceId:montage,dimensionId:'mont-p',quantity:'1'}],reason:'Montagem inclui dobradiça no exemplo sintético'},{operationIds:['row-1:op-2'],options:[{serviceId:paint,dimensionId:'paint-full',quantity:'1'}],reason:''},{operationIds:['row-3:op-1'],options:[{serviceId:montage,dimensionId:'mont-p',quantity:'1'}],reason:''},{operationIds:['row-4:manual'],options:[{serviceId:mechanics,dimensionId:'mech-p',quantity:'1'}],reason:'Revisão técnica sintética de serviço manual'}]})
const assemble=(r:CiliaScopeReview=scope())=>assembleCiliaReviewedScope(xml(),catalog,'left',r)
test('Cilia review: preserves all rows, per-operation candidates, parts and potential parent clusters',()=>{
 const p=preview();assert.deepEqual(p.source.issues,[]);assert.equal(p.canWrite,false);assert.equal(p.rows.length,4);assert.equal(p.rows.flatMap(r=>r.operations).length,5)
 assert.deepEqual(p.groupingCandidates.map(g=>g.sourceRowIds),[['row-1','row-2']]);assert.equal(p.components.filter(c=>c.supply==='partner').length,2)
 assert.equal(p.rows[0]!.operations[0]!.candidates[0]!.dimensions[0]!.dimensionId,'mont-p')
 assert.equal(p.rows[0]!.operations[0]!.candidates[0]!.dimensions[0]!.requiresTechnicalReview,true)
})
test('Cilia review: grouped scope accounts for every source and excludes partner components only from billable comparison',()=>{
 const p=assemble();assert.equal(p.canWrite,false);assert.deepEqual(p.comparisonOnly.totals,{servicesGross:'215',serviceDiscount:'0',components:'70',total:'285'})
 assert.equal(p.comparisonOnly.services.length,4);assert.equal(p.comparisonOnly.services[0]!.total,'60');assert.deepEqual(p.sourceLinks.groups[0]!.operationIds,['row-1:op-1','row-2:op-1'])
 assert.equal(p.partnerComponents.length,2);assert.equal(p.comparisonOnly.components.length,1);assert.equal(p.sourceLinks.components.length,3);assert.ok(p.blockers.includes('PARTNER_COMPONENT_PERSISTENCE_PENDING'))
})
test('Cilia review: changed evidence, missing/duplicate rows or operations cannot pass',()=>{
 for(const mutate of [(s:CiliaScopeReview)=>{s.evidenceSha256='a'.repeat(64)},(s:CiliaScopeReview)=>{s.scopeReviewed=false},(s:CiliaScopeReview)=>{s.pieces[0]!.sourceRowIds.pop()},(s:CiliaScopeReview)=>{s.pieces[1]!.sourceRowIds.push('row-1')},(s:CiliaScopeReview)=>{s.groups.pop()},(s:CiliaScopeReview)=>{s.groups[1]!.operationIds.push('row-1:op-1')}]){
  const s=scope();mutate(s);assert.throws(()=>assemble(s),{code:'CILIA_SCOPE_INVALID'})
 }
})
test('Cilia review: prohibit unjustified grouping, mixed scope and incompatible dimensions',()=>{
 for(const mutate of [(s:CiliaScopeReview)=>{s.pieces[0]!.reason=''},(s:CiliaScopeReview)=>{s.groups[0]!.reason=''},(s:CiliaScopeReview)=>{s.groups[0]!.operationIds.push('row-1:op-2')},(s:CiliaScopeReview)=>{s.groups[0]!.operationIds.push('row-3:op-1')},(s:CiliaScopeReview)=>{s.groups[0]!.options[0]!.dimensionId='paint-full'},(s:CiliaScopeReview)=>{s.groups[0]!.options[0]!.quantity='0'},(s:CiliaScopeReview)=>{s.groups[3]!.reason=''}]){
  const s=scope();mutate(s);assert.throws(()=>assemble(s),{code:'CILIA_SCOPE_INVALID'})
 }
})
