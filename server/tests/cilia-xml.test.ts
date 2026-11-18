import test from 'node:test'
import assert from 'node:assert/strict'
import {readCiliaBudgetXml} from '../cilia-xml.ts'

const tag=(name:string,value:string)=>'<'+name+'>'+value+'</'+name+'>'
const item=(override:Record<string,string>={})=>{
  const fields={tipo_item:'Peça',tipo:'Impacto',codigo:'SINTETICO',nome:'CAPÔ',troca:'true',remocao_instalacao:'true',pintura:'true',reparacao:'false',inclusao_manual:'true',preco:'300.00',preco_liquido:'300.00',percentual_desconto:'0',quantidade:'1',tipo_remocao_instalacao:'Funilaria',hora_remocao_instalacao:'1',hora_reparacao:'',hora_pintura:'2',fornecimento:'Associação',...override}
  return tag('item',Object.entries(fields).map(([k,v])=>tag(k,v)).join(''))
}
const manual=item({tipo_item:'Serviço',nome:'SERVIÇO MANUAL SINTÉTICO',troca:'false',remocao_instalacao:'false',pintura:'false',preco:'10',preco_liquido:'10',hora_remocao_instalacao:'',hora_pintura:'',tipo_remocao_instalacao:'',fornecimento:'Oficina'})
const group=(name:string,v:string,h:string)=>tag(name,tag('valor',v)+tag('tempo',h))
const section=(name:string,active:boolean)=>tag(name,[
  group('troca_e_remocao_instalacao',active?'50':'0',active?'1':'0'),
  group('pintura',active?'120':'0',active?'2':'0'),group('reparacao','0','0'),
  group('funilaria',active?'50':'0',active?'1':'0'),...['vidracaria','tapecaria','eletrica','mecanica'].map(k=>group(k,'0','0')),
  tag('valor_servico_manual',active?'10':'0'),tag('valor_fornecimento_oficina','0'),tag('valor_fornecimento_seguradora',active?'300':'0'),tag('valor_total',active?'480':'0')
].join(''))
const fixture=(lines=item()+manual)=>'<?xml version="1.0" encoding="UTF-8"?>'+tag('orcamento',[
 tag('seguradora',tag('nome','ASSOCIAÇÃO SINTÉTICA')+tag('cnpj','00000000000000')),
 tag('veiculo',tag('placa','ZZZ0Z00')+tag('chassi','SINTETICO')+tag('nome_veiculo','VEÍCULO SINTÉTICO')+tag('cor','BRANCA')+tag('tipo_pintura','Comum')),
 ...Object.entries({numero_orcamento:'QA1',versao_orcamento:'1',numero_sinistro:'EVENTO-QA',status:'Em orçamentação',nome_da_versao:'Inicial',data_criacao_orcamento:'01/01/2000 00:00',data_alteracao_status_orcamento:'01/01/2000 00:00',tipo_do_processo:'Terceiro'}).map(([k,v])=>tag(k,v)),
 tag('padrao_mao_de_obra',Object.entries({valor_hora_mao_de_obra:'50',valor_hora_reparacao:'40',valor_hora_pintura_tricoat:'80',valor_hora_pintura:'60',majoracao:'0',desconto:'0'}).map(([k,v])=>tag(k,v)).join('')),
 tag('itens_orcamento',lines),tag('resumo_geral',section('totais_em_impacto',true)+section('totais_sem_cobertura',false)+section('totais_sob_analise',false)),
 tag('total_do_orcamento',Object.entries({valor_bruto_pecas:'0',valor_desconto:'0',valor_desconto_pecas_manuais:'0',valor_liquido_mao_de_obra:'180',valor_total_geral:'480',valor_pecas_pela_oficina:'0',valor_franquia:'0',valor_deducao:'0',valor_total_liquido_geral:'180'}).map(([k,v])=>tag(k,v)).join(''))
].join(''))
const parse=(s:string)=>readCiliaBudgetXml(Buffer.from(s))

test('Cilia XML: replacement flags are one labor operation; partner parts never office revenue',()=>{
 const p=parse(fixture())
 assert.equal(p.canWrite,false)
 assert.equal(p.financialIntegrity,true,JSON.stringify(p.issues))
 assert.deepEqual(p.items[0]!.operations,[{kind:'T',hours:'1',rate:'50',amount:'50'},{kind:'P',hours:'2',rate:'60',amount:'120'}])
 assert.deepEqual(p.calculated,{labor:'180',workshopParts:'0',partnerParts:'300',workshopTotal:'180',global:'480'})
 assert.equal(p.items[1]!.typeKind,'service')
 assert.notEqual(p.items[1]!.id,p.items[0]!.id)
 assert.match(p.evidenceSha256,/^[a-f0-9]{64}$/)
 assert.equal(p.evidenceSha256,parse(fixture()).evidenceSha256)
 assert.notEqual(p.evidenceSha256,parse(fixture().replace('CAPÔ','CAPO')).evidenceSha256)
})
test('Cilia XML: explicit zero is different from absent and missing rates are not guessed',()=>{
 const zero=parse(fixture(item({hora_remocao_instalacao:'0'})+manual))
 assert.equal(zero.items[0]!.operations[0]!.amount,'0')
 const missing=parse(fixture(item({hora_remocao_instalacao:''})+manual))
 assert.equal(missing.items[0]!.operations[0]!.hours,null)
 assert.equal(missing.calculated,null)
 assert.equal(missing.financialIntegrity,false)
 const unknown=parse(fixture().replace('<tipo_pintura>Comum','<tipo_pintura>Desconhecida'))
 assert.ok(unknown.issues.includes('PAINT_RATE_REVIEW'))
 assert.equal(unknown.calculated,null)
})
test('Cilia XML: mismatched totals, other coverage, non-unit quantity and deductible remain review-only',()=>{
 const mismatch=parse(fixture().replace('<valor_total_geral>480','<valor_total_geral>481'))
 assert.ok(mismatch.issues.includes('TOTAL_MISMATCH:global'))
 assert.equal(mismatch.financialIntegrity,false)
 assert.ok(parse(fixture(item({tipo:'Sob análise'})+manual)).issues.includes('SCOPE_REVIEW:row-1'))
 assert.equal(parse(fixture(item({quantidade:'2'})+manual)).calculated,null)
 assert.ok(parse(fixture().replace('<valor_franquia>0','<valor_franquia>15')).issues.includes('PARTICIPATION_REVIEW'))
 const unknown=parse(fixture(item({fornecimento:'Ignorado'})+manual))
 assert.ok(unknown.issues.includes('SUPPLY_REVIEW:row-1'))
})
test('Cilia XML: reject dangerous/unsupported syntax and duplicate fields with sanitized errors',()=>{
 for(const s of [
  fixture().replace('<orcamento>','<!DOCTYPE orcamento [<!ENTITY e SYSTEM "file:///etc/passwd">]><orcamento>'),
  fixture().replace('CAPÔ','&unknown;'),fixture().replace('CAPÔ','&#0;'),
  fixture().replace('<orcamento>','<orcamento atributo="x">'),
  fixture().replace('<nome>CAPÔ</nome>','<nome>CAPÔ</nome><nome>CAPÔ</nome>'),
  fixture().replace('</item>','</wrong>'),fixture()+'<orcamento/>',
  fixture().replace('CAPÔ','A <b>B</b>'),fixture().replace('<preco>300.00','<preco>NaN'),
  fixture().replace('CAPÔ','A'.repeat(600000))
 ])assert.throws(()=>parse(s),{code:'CILIA_XML_INVALID'})
 assert.throws(()=>readCiliaBudgetXml(Uint8Array.of(0xff)),{code:'CILIA_XML_INVALID'})
 assert.equal(parse(fixture().replace('CAPÔ','A &amp; B &#x43;')).items[0]!.name,'A & B C')
})
