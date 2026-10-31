import type {CatalogItem,HierarchyNode} from '../shared/commercial.ts'
import {selectablePieces} from './piece-navigation.ts'
import {mapPaths,mapPairs} from './map-navigation-data.ts'
export type MapNode=HierarchyNode&{choiceAxis?:'side'|'position';choice?:'first'|'second'|'both';sideContext?:'motorista'|'passageiro';regionKey?:string}
const regions:Record<string,string>={Frente:'frente','Estrutura dianteira':'estrutura-dianteira',Motorista:'motorista',Passageiro:'passageiro',Traseira:'traseira','Estrutura traseira':'estrutura-traseira',Topo:'teto'}
const nodeId=(path:readonly string[])=>'map:'+JSON.stringify(path)
// Projection of the same live catalog; navigation IDs never become commercial identities.
export function canonicalMap(catalog:CatalogItem[]):MapNode[]{
 const roots:MapNode[]=[],groups=new Map<string,MapNode>(),known=new Map(catalog.filter(p=>p.kind==='peca'&&p.code).map(p=>[p.code!,p])),valid=selectablePieces(catalog)
 for(const [code,path]of mapPaths){
  let parent:MapNode|undefined
  for(let i=0;i<path.length;i++){
   const id=nodeId(path.slice(0,i+1));let node=groups.get(id)
   if(!node){node=i===path.length-1?{id:known.get(code)?.id??'map-missing:'+code,tipo:'peca',nome:path[i]!,codigo_peca:code}:{id,tipo:'grupo',nome:path[i]!,itens:[]};if(i===0)node.regionKey=regions[path[0]!];groups.set(id,node);if(parent)parent.itens!.push(node);else roots.push(node)}
   parent=node
  }
 }
 for(const pair of mapPairs){
  const parent=groups.get(nodeId(pair.path))!,children=parent.itens! as MapNode[]
  parent.choiceAxis=pair.axis
  if(pair.axis==='position')parent.sideContext=pair.path[0]==='Motorista'?'motorista':'passageiro'
  for(const [i,code]of pair.codes.entries()){const leaf=children.find(n=>n.codigo_peca===code)!;leaf.choice=i===0?'first':'second'}
  if(pair.codes.every(code=>valid.has(code)))children.push({id:parent.id+':both',tipo:'acao_ambos',nome:'Ambos',gera_codigos_peca:[...pair.codes],choice:'both'})
 }
 return roots
}
export function mapChoicePosition(parent:MapNode|undefined,node:MapNode,index:number,count:number){
 if(parent?.choiceAxis==='side'&&node.choice)return node.choice==='both'?{left:'50%',top:'20%'}:{left:node.choice==='first'?'24%':'76%',top:'72%'}
 if(parent?.choiceAxis==='position'){
  if(node.choice==='first')return{left:'50%',top:'18%'}
  if(node.choice==='second')return{left:'50%',top:'82%'}
  const right=parent.sideContext==='motorista'
  return{left:(node.choice==='both'?right:!right)?'80%':'20%',top:'50%'}
 }
 const angle=index*2*Math.PI/count-Math.PI/2,radius=count<=2?29:count<=4?32:36
 return{left:`${50+Math.cos(angle)*radius}%`,top:`${50+Math.sin(angle)*radius}%`}
}
export function mapPage(total:number,page:number,root:boolean){
 if(root||total<=8)return{start:0,end:total,page:0,pages:1}
 const size=Math.ceil(total/Math.ceil(total/8)),pages=Math.ceil(total/size),current=Math.min(Math.max(page,0),pages-1)
 return{start:current*size,end:Math.min((current+1)*size,total),page:current,pages}
}
