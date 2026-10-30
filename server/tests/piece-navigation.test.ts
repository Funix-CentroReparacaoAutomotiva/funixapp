import test from 'node:test'
import assert from 'node:assert/strict'
import {hierarchy,hierarchyPieces} from '../hierarchy.ts'
import type {CatalogItem,HierarchyNode} from '../../shared/commercial.ts'
import {classifyPiece,contextualTree,functionalTree,functionalGroups,groupSelection,nodeCodes,selectablePieces} from '../../src/piece-navigation.ts'
const catalog:CatalogItem[]=hierarchyPieces().map(p=>({id:'v2:'+p.code,kind:'peca',code:p.code,name:p.name,side:p.side,active:true,status:'proposta',source:'hierarquia-v2',suggestion:false,serviceId:null,revision:1,createdAt:'2026-10-30',updatedAt:'2026-10-30'}))
const walk=(n:HierarchyNode):HierarchyNode[]=>[n,...(n.itens??[]).flatMap(walk)]
test('Etapa C one functional projection classifies every real V2 identity once; operator codes use the same catalog and residual group',()=>{
 const own={...catalog[0]!,id:'own',source:'operador' as const,code:'operador_x',name:'Cadastro posterior'},tree=functionalTree([...catalog,own])
 assert.deepEqual(tree.map(n=>n.nome),functionalGroups)
 const leaves=tree.flatMap(n=>n.itens!),codes=leaves.map(n=>n.codigo_peca)
 assert.equal(leaves.length,164);assert.equal(new Set(codes).size,164)
 for(const p of [...catalog,own]){const leaf=tree.find(n=>n.nome===classifyPiece(p))!.itens!.find(n=>n.id===p.id)!;assert.equal(leaf.codigo_peca,p.code)}
 assert.equal(classifyPiece(own),'Outros');assert.equal(classifyPiece(catalog.find(p=>p.code==='capo')!),'Lataria')
})
test('Etapa C states use unique selectable codes, ignore inactive/uncoded items and never mark empty groups all',()=>{
 const good=catalog[0]!,off={...catalog[1]!,active:false},noCode={...catalog[2]!,code:null},valid=selectablePieces([good,off,noCode]),leaf={id:'a',tipo:'peca',nome:'A',codigo_peca:good.code!}as HierarchyNode
 const group={id:'g',tipo:'grupo',nome:'G',itens:[leaf,leaf,{...leaf,codigo_peca:off.code!}]}as HierarchyNode
 assert.deepEqual(groupSelection(group,valid,()=>false),{total:1,count:0,state:'none'})
 assert.deepEqual(groupSelection(group,valid,()=>true),{total:1,count:1,state:'all'})
 assert.deepEqual(groupSelection({...group,itens:[]},valid,()=>true),{total:0,count:0,state:'none'})
 const two={...group,itens:[leaf,{...leaf,codigo_peca:catalog[2]!.code!}]};assert.equal(groupSelection(two,selectablePieces(catalog),c=>c===good.code).state,'partial')
})
test('Etapa C contextual projection removes redundant side groups and opposite identities without modifying V2',()=>{
 const before=JSON.stringify(hierarchy),valid=selectablePieces(catalog)
 for(const [key,root]of Object.entries(hierarchy.regioes)){
  const side=key==='motorista'||key==='passageiro'?key:null,projected=contextualTree(root,side,catalog)!,nodes=walk(projected)
  if(side){assert(!nodes.some(n=>n.tipo==='acao_ambos'||n.tipo==='grupo_lados'));for(const code of nodeCodes(projected,valid)){const p=valid.get(code)!;assert(!p.side||p.side===side)}}
  else for(const pair of nodes.filter(n=>n.tipo==='grupo_lados')){const both=pair.itens!.find(n=>n.tipo==='acao_ambos');if(both){assert.equal(new Set(both.gera_codigos_peca).size,2);assert(both.gera_codigos_peca!.every(c=>pair.itens!.some(n=>n.tipo==='peca'&&n.codigo_peca===c)))}}
 }
 assert.equal(JSON.stringify(hierarchy),before)
})
test('Etapa C Ambos exists only for two distinct selectable real equivalents; no synthetic identity or mass-selection action',()=>{
 const pair=Object.values(hierarchy.regioes).flatMap(walk).find(n=>n.tipo==='grupo_lados'&&n.itens?.some(c=>c.tipo==='acao_ambos'))!,both=pair.itens!.find(n=>n.tipo==='acao_ambos')!,code=both.gera_codigos_peca![0]
 assert(contextualTree(pair,null,catalog)!.itens!.some(n=>n.tipo==='acao_ambos'))
 assert(!contextualTree(pair,null,catalog.map(p=>p.code===code?{...p,active:false}:p))!.itens!.some(n=>n.tipo==='acao_ambos'))
 assert(!contextualTree({...pair,itens:pair.itens!.map(n=>n.tipo==='acao_ambos'?{...n,gera_codigos_peca:[code!,code!]}:n)},null,catalog)!.itens!.some(n=>n.tipo==='acao_ambos'))
})
