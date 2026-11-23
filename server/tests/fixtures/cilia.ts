import type {DatabaseSync} from 'node:sqlite'
import {commercialFixture} from './commercial.ts'
import {CiliaApplication} from '../../cilia-application.ts'
import {previewCiliaXml} from '../../cilia-review.ts'

const tag=(name:string,value:string)=>'<'+name+'>'+value+'</'+name+'>'
const fields=(v:Record<string,string>)=>Object.entries(v).map(([k,x])=>tag(k,x)).join('')
const g=(k:string,v:string,t:string)=>tag(k,fields({valor:v,tempo:t}))
const section=(name:string,on:boolean)=>tag(name,[
 g('troca_e_remocao_instalacao',on?'100':'0',on?'2':'0'),g('pintura','0','0'),g('reparacao','0','0'),g('funilaria',on?'100':'0',on?'2':'0'),
 ...['vidracaria','tapecaria','eletrica','mecanica'].map(k=>g(k,'0','0')),
 fields({valor_servico_manual:'0',valor_fornecimento_oficina:'0',valor_fornecimento_seguradora:on?'300':'0',valor_total:on?'400':'0'})
].join(''))
export const xml=()=>Buffer.from(tag('orcamento',[
 fields({numero_orcamento:'QA-CILIA',versao_orcamento:'1',numero_sinistro:'QA-EVENT',status:'Em orçamentação',nome_da_versao:'Inicial',data_criacao_orcamento:'QA',data_alteracao_status_orcamento:'QA',tipo_do_processo:'Terceiro'}),
 tag('seguradora',fields({nome:'ASSOCIAÇÃO SINTÉTICA',cnpj:'00000000000000'})),tag('veiculo',fields({placa:'ZZZ0Z00',chassi:'SINTETICO',nome_veiculo:'QA',cor:'BRANCA',tipo_pintura:'Comum'})),
 tag('padrao_mao_de_obra',fields({valor_hora_mao_de_obra:'50',valor_hora_reparacao:'40',valor_hora_pintura_tricoat:'80',valor_hora_pintura:'60',majoracao:'0',desconto:'0'})),
 tag('itens_orcamento',tag('item',fields({tipo_item:'Peça',tipo:'Impacto',codigo:'QA',nome:'CAPÔ',troca:'true',remocao_instalacao:'true',pintura:'false',reparacao:'false',inclusao_manual:'true',preco:'300',preco_liquido:'300',percentual_desconto:'0',quantidade:'1',tipo_remocao_instalacao:'Funilaria',hora_remocao_instalacao:'2',hora_reparacao:'',hora_pintura:'',fornecimento:'Associação'}))),
 tag('resumo_geral',section('totais_em_impacto',true)+section('totais_sem_cobertura',false)+section('totais_sob_analise',false)),tag('total_do_orcamento',fields({valor_bruto_pecas:'0',valor_desconto:'0',valor_desconto_pecas_manuais:'0',valor_liquido_mao_de_obra:'100',valor_total_geral:'400',valor_pecas_pela_oficina:'0',valor_franquia:'0',valor_deducao:'0',valor_total_liquido_geral:'100'}))
].join('')))
export function setupCiliaFixture(db:DatabaseSync){
 const f=commercialFixture(db)
 const at=f.atendimentos.create({name:'QA Cilia',plate:'ZZZ0Z00'})
 f.pricing.saveSettings(at.id,{revision:f.pricing.settings(at.id).revision,tableId:'table',colorId:'color',riskId:'risk',mrId:'mr'})
 const catalog=f.commercial.catalogs().items,p=previewCiliaXml(xml(),catalog,'left'),piece=catalog.find(c=>c.code==='capo')!
 const raw={xmlBase64:xml().toString('base64'),steering:'left',attendanceRevision:at.revision,review:{evidenceSha256:p.source.evidenceSha256,scopeReviewed:true,pieces:[{pieceId:piece.id,sourceRowIds:['row-1'],diagnosisId:null,intensity:null,reason:''}],groups:[{operationIds:['row-1:op-1'],options:[{serviceId:f.service.id,dimensionId:f.dimension.id,quantity:'1'}],reason:'Serviço sintético equivalente no ensaio'}]}}
 return {db,f,at,raw,app:new CiliaApplication(db)}
}
