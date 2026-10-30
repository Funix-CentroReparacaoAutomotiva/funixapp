import type {CatalogItem,HierarchyNode} from '../shared/commercial.ts'
import {catalogItemUsable} from '../shared/commercial.ts'
export const functionalGroups=['Lataria','Estrutura','Vidros','Acessórios','Interior','Outros'] as const
export type FunctionalGroup=typeof functionalGroups[number]
// Existing V2 code families only. These are navigation rules, not a second catalog.
const families:Record<Exclude<FunctionalGroup,'Outros'>,ReadonlySet<string>>={
 Lataria:new Set(['para_choque_dianteiro','para_choque_traseiro','capo','para_lama_dianteiro','tampa_porta_malas','porta_carga_traseira','porta_dianteira','porta_traseira','lateral_traseira','porta_carga_lateral','portinhola_combustivel','ponteira_para_choque_traseiro','teto_chapa']),
 Estrutura:new Set(['alma_para_choque_dianteiro','alma_para_choque_traseiro','painel_dianteiro','painel_traseiro','travessa_do_radiador','cofre_motor_dianteiro','cofre_motor_traseiro','longarina_dianteira','longarina_traseira','bojo_estepe','assoalho_porta_malas','caixa_roda_dianteira','caixa_roda_traseira','caixa_roda_generica','caixa_de_ar','coluna_generica','coluna_a','coluna_b','coluna_c']),
 Vidros:new Set(['para_brisa','vidro_dianteiro_outro','vidro_traseiro','vidro_porta_dianteira','vidro_porta_traseira','vidro_teto','vidro_teto_solar','vidro_panoramico']),
 Interior:new Set(['interno_porta_malas','acabamentos_porta_malas','moldura_porta_malas','interno_porta_dianteira','interno_porta_traseira','painel_lateral_interno']),
 Acessórios:new Set(['grade_dianteira','grade_inferior_central','grade_inferior','grade_lateral','grade_traseira','farol','alojamento_farol','farol_milha','moldura_farol_milha','churrasqueira','defletor_inferior_dianteiro','difusor_dianteiro','spoiler_dianteiro','sensor_estacionamento_dianteiro','frisos_dianteiros','moldura_dianteira_generica','acabamentos_plasticos_dianteiros','adesivos_dianteiros','defletor_inferior_traseiro','difusor_traseiro','spoiler_traseiro','sensor_estacionamento_traseiro','lanterna_traseira','alojamento_lanterna_traseira','lanterna_central','lanterna_re','luz_placa','lampada_luz_placa','aerofolio','adesivos_porta_malas','para_barro_traseiro','frisos_traseiros','moldura_traseira_generica','acabamentos_plasticos_traseiros','adesivos_traseiros','macaneta_dianteira','friso_porta_dianteira','moldura_porta_dianteira','retrovisor','macaneta_traseira','friso_porta_traseira','moldura_porta_traseira','para_barro_dianteiro','frisos_laterais','moldura_lateral','acabamentos_plasticos_laterais','adesivos_laterais','rack_lateral','spoiler_lateral','antena','rack_teto','bagageiro','acabamentos_plasticos_teto','adesivos_teto'])
}
export function classifyPiece(item:CatalogItem):FunctionalGroup{
 const family=item.code?.split('__')[0]
 return functionalGroups.find(group=>group!=='Outros'&&family&&families[group].has(family))??'Outros'
}
export const selectablePieces=(catalog:CatalogItem[])=>new Map(catalog.filter(c=>c.kind==='peca'&&catalogItemUsable(c)).map(c=>[c.code!,c]))
export function functionalTree(catalog:CatalogItem[]):HierarchyNode[]{
 const pieces=[...new Map(catalog.filter(c=>c.kind==='peca'&&c.code).map(c=>[c.code!,c])).values()]
 return functionalGroups.map(group=>({id:'functional:'+group,tipo:'grupo',nome:group,itens:pieces.filter(c=>classifyPiece(c)===group).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')).map(c=>({id:c.id,tipo:'peca',nome:c.name,codigo_peca:c.code!,lado:c.side}))}))
}
export function nodeCodes(node:HierarchyNode,valid:ReadonlyMap<string,CatalogItem>):string[]{
 return [...new Set([...(node.tipo==='peca'&&node.codigo_peca?[node.codigo_peca]:[]),...(node.tipo==='acao_ambos'?node.gera_codigos_peca??[]:[]),...(node.itens??[]).flatMap(c=>nodeCodes(c,valid))])].filter(code=>valid.has(code))
}
export function groupSelection(node:HierarchyNode,valid:ReadonlyMap<string,CatalogItem>,selected:(code:string)=>boolean){
 const codes=nodeCodes(node,valid),count=codes.filter(selected).length
 return{total:codes.length,count,state:count===0?'none':count===codes.length?'all':'partial'} as const
}
export function contextualTree(node:HierarchyNode,side:'motorista'|'passageiro'|null,catalog:CatalogItem[]):HierarchyNode|null{
 const known=new Map(catalog.filter(c=>c.kind==='peca'&&c.code).map(c=>[c.code!,c])),valid=selectablePieces(catalog)
 if(node.tipo==='peca'){
  const item=known.get(node.codigo_peca??''),declared=item?.side||node.lado||''
  if(side&&declared&&declared!==side)return null
  return node
 }
 if(node.tipo==='acao_ambos')return null // Kept only by its real, verified parent pair below.
 const children=(node.itens??[]).filter(c=>c.tipo!=='acao_ambos').flatMap(c=>{const child=contextualTree(c,side,catalog);return child?[child]:[]})
 if(node.tipo==='grupo_lados'){
  if(side&&children.length===1)return{...children[0],nome:node.nome}
  if(!side){
   const m=children.find(c=>(known.get(c.codigo_peca??'')?.side||c.lado)==='motorista'),p=children.find(c=>(known.get(c.codigo_peca??'')?.side||c.lado)==='passageiro')
   const both=node.itens?.find(c=>c.tipo==='acao_ambos'&&c.gera_codigos_peca?.length===2&&new Set(c.gera_codigos_peca).size===2&&m?.codigo_peca&&p?.codigo_peca&&c.gera_codigos_peca.includes(m.codigo_peca)&&c.gera_codigos_peca.includes(p.codigo_peca)&&c.gera_codigos_peca.every(code=>valid.has(code)))
   if(both)children.push(both)
  }
 }
 return{...node,itens:children}
}
