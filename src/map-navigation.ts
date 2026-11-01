import type{CatalogItem,HierarchyNode}from'../shared/commercial.ts'
import{catalogItemUsable}from'../shared/commercial.ts'
import source from'./data/map-navigation.json' with {type:'json'}
// Navigation projection only. No catalog writes, generated commercial IDs or prices.
export const mapSpecification=source
export function mapTree(catalog:CatalogItem[]):HierarchyNode[]{
 const known=new Map(catalog.filter(c=>c.kind==='peca'&&c.code).map(c=>[c.code!,c]))
 const roots:HierarchyNode[]=Object.entries(source.regions).map(([nome,key])=>({id:key,nome,tipo:'grupo',itens:[]}))
 for(const entry of source.pieces){
  const root=roots.find(n=>n.nome===entry.path[0])!;let parent=root
  for(const name of entry.path.slice(1,-1)){
   let group=parent.itens!.find(n=>n.nome===name&&n.tipo==='grupo')
   if(!group){group={id:parent.id+'/'+name,nome:name,tipo:'grupo',itens:[]};parent.itens!.push(group)}parent=group
  }
  const item=known.get(entry.code)
  parent.itens!.push({id:item?.id??'map:'+entry.code,tipo:'peca',nome:entry.path.at(-1)!,codigo_peca:entry.code,lado:item?.side||entry.side||undefined})
 }
 for(const pair of source.pairs){
  let parent=roots.find(n=>n.nome===pair.path[0])!
  for(const name of pair.path.slice(1))parent=parent.itens!.find(n=>n.nome===name)!
  // A pair is usable only as a whole; never shrink it to one surviving code.
  if(pair.codes.every(c=>{const item=known.get(c);return item&&catalogItemUsable(item)}))parent.itens!.push({id:parent.id+'/ambos',tipo:'acao_ambos',nome:'Ambos',gera_codigos_peca:[...pair.codes]})
  if(pair.axis==='Lado'){
   parent.tipo='grupo_lados'
   for(const child of parent.itens??[])if(child.tipo==='peca')child.nome=child.lado==='motorista'?'Motorista':'Passageiro'
  }
 }
 return roots
}
export function mapPage(nodes:HierarchyNode[],page:number,initial:boolean){
 if(initial||nodes.length<=13)return{nodes,pages:1,page:0}
 const pages=Math.ceil(nodes.length/8),index=Math.min(Math.max(0,page),pages-1)
 return{nodes:nodes.slice(index*8,(index+1)*8),pages,page:index}
}
// Percent coordinates. Four short categories occupy the inner ring for 13-entry sides.
export function radialPosition(node:HierarchyNode,nodes:HierarchyNode[],parent:HierarchyNode|undefined,region:string|null){
 if(parent?.tipo==='grupo_lados')return node.tipo==='acao_ambos'?{left:50,top:20}:node.lado==='motorista'?{left:23,top:72}:{left:77,top:72}
 if((region==='motorista'||region==='passageiro')&&parent&&['Roda','Pinça de freio','Caixa de roda','Para-barro'].includes(parent.nome)){
  if(node.tipo==='acao_ambos')return{left:region==='motorista'?79:21,top:50}
  return node.nome==='Dianteiro'?{left:50,top:20}:node.nome==='Traseiro'?{left:50,top:80}:{left:region==='motorista'?21:79,top:50}
 }
 const innerNames=['Roda','Pinça de freio','Para-lama','Para-barro'],inner=nodes.length>8?nodes.filter(n=>innerNames.includes(n.nome)):[]
 // Internal dense groups without these named categories still use two rings.
 const inside=nodes.length>8?(inner.length===4?inner:nodes.slice(9)):[]
 const innerIndex=inside.indexOf(node),outer=nodes.filter(n=>!inside.includes(n)),count=innerIndex>=0?inside.length:outer.length
 const angle=(innerIndex>=0?innerIndex*Math.PI/2:outer.indexOf(node)*2*Math.PI/count)-Math.PI/2,radius=innerIndex>=0?16.25:nodes.length>8?38.75:35
 return{left:50+Math.cos(angle)*radius,top:50+Math.sin(angle)*radius,inner:innerIndex>=0}
}
// Discretionary Portuguese syllable breaks; names/ARIA/catalogs stay verbatim.
export function radialLabel(label:string){
 const breaks:Record<string,number>={abastecimento:8,acabamentos:5,churrasqueira:7,complementos:6,componentes:5,combustível:6,especificada:8,especificado:8,estacionamento:9}
 return label.replace(/\p{L}+/gu,word=>{const at=breaks[word.toLocaleLowerCase('pt-BR')];return at?word.slice(0,at)+'\u00ad'+word.slice(at):word})
}
