import test from'node:test'
import assert from'node:assert/strict'
import{readFileSync}from'node:fs'
import{mapTree,mapSpecification,radialPosition,mapPage}from'../../src/map-navigation.ts'
import{hierarchy,hierarchyPieces}from'../hierarchy.ts'
import type{CatalogItem,HierarchyNode}from'../../shared/commercial.ts'
const catalog:CatalogItem[]=hierarchyPieces().map(p=>({id:'v2:'+p.code,kind:'peca',code:p.code,name:p.name,side:p.side,active:true,status:'proposta',source:'hierarquia-v2',suggestion:false,serviceId:null,revision:1,createdAt:'QA',updatedAt:'QA'}))
const walk=(node:HierarchyNode):HierarchyNode[]=>[node,...(node.itens??[]).flatMap(walk)]
const tree=mapTree(catalog),all=tree.flatMap(walk)
const csv=(file:string)=>readFileSync(new URL('../../docs/revisao-integrada/etapa4/'+file,import.meta.url),'utf8').trim().split('\n').slice(1).map(l=>l.split(';'))
test('Stage4 all 163 original identities occur once, unchanged catalogs/hierarchy; 7 roots and 13 direct side categories',()=>{
 const before=JSON.stringify({catalog,hierarchy});mapTree(catalog)
 const leaves=all.filter(n=>n.tipo==='peca');assert.equal(leaves.length,163);assert.equal(new Set(leaves.map(n=>n.codigo_peca)).size,163)
 assert.deepEqual(leaves.map(n=>n.codigo_peca).sort(),catalog.map(c=>c.code).sort());for(const l of leaves)assert.equal(l.id,catalog.find(c=>c.code===l.codigo_peca)!.id)
 assert.deepEqual(tree.map(n=>[n.id,n.itens!.length]),[['frente',8],['estrutura_dianteira',5],['motorista',13],['passageiro',13],['traseira',8],['estrutura_traseira',7],['teto',4]])
 assert.equal(JSON.stringify({catalog,hierarchy}),before)
})
test('Stage4 frozen PR27 paths match every code; D01 and D02 overrides are navigation only',()=>{
 const paths=new Map<string,string[]>();function visit(n:HierarchyNode,path:string[]){const next=[...path,n.nome];if(n.tipo==='peca')paths.set(n.codigo_peca!,next);n.itens?.forEach(c=>visit(c,next))}tree.forEach(r=>visit(r,[]))
 const rows=csv('FUNIX_MATRIZ_163_PROPOSTA.csv');assert.equal(rows.length,163)
 for(const row of rows){const code=row[0]!,actual=paths.get(code)!;assert(actual,code)
  if(code.startsWith('coluna_generica__'))assert.deepEqual(actual,[row[3],'Estrutura lateral','Colunas','Coluna (posição não especificada)'])
  else if(code.startsWith('caixa_roda_generica__'))assert.deepEqual(actual,[row[3],'Caixa de roda','Posição não especificada'])
  else{const expected=row[9]!.split(' > ');assert.deepEqual(actual,expected,code)}
 }
})
const pairs=csv('FUNIX_AMBOS_PROPOSTOS.csv')
for(const row of pairs)test('Stage4 exact documented Ambos: '+row[1],()=>{
 const path=row[1]!.split(' > ');let node=tree.find(n=>n.nome===path[0])!;for(const p of path.slice(1))node=node.itens!.find(n=>n.nome===p)!
 const both=node.itens!.find(n=>n.tipo==='acao_ambos')!;assert(both);assert.deepEqual(both.gera_codigos_peca,[row[3],row[4]]);assert.equal(new Set(both.gera_codigos_peca).size,2)
 for(const code of both.gera_codigos_peca!){assert(catalog.some(c=>c.code===code));assert(node.itens!.some(n=>n.tipo==='peca'&&n.codigo_peca===code))}
 const positions=node.itens!.map(n=>({n,p:radialPosition(n,node.itens!,node,tree.find(r=>r.nome===path[0])!.id)}));const b=positions.find(x=>x.n.tipo==='acao_ambos')!.p
 if(row[2]==='Lado'){assert(b.top<positions.find(x=>x.n.lado==='motorista')!.p.top);assert(positions.find(x=>x.n.lado==='motorista')!.p.left<positions.find(x=>x.n.lado==='passageiro')!.p.left)}
 else{assert(b.top>positions.find(x=>x.n.nome==='Dianteiro')!.p.top&&b.top<positions.find(x=>x.n.nome==='Traseiro')!.p.top);assert(path[0]==='Motorista'?b.left>50:b.left<50)}
 for(const code of both.gera_codigos_peca!){const inactive=mapTree(catalog.map(c=>c.code===code?{...c,active:false}:c)).flatMap(walk);assert(!inactive.some(n=>n.id===both.id));assert(inactive.some(n=>n.codigo_peca===code))}
})
test('Stage4 exactly 15 side pairs plus 8 axle pairs; no generic axle or single-code Ambos',()=>{
 assert.equal(pairs.length,23);assert.equal(mapSpecification.pairs.length,23);assert.equal(all.filter(n=>n.tipo==='acao_ambos').length,23);assert.equal(pairs.filter(p=>p[2]==='Lado').length,15);assert.equal(pairs.filter(p=>p[2]==='Posição').length,8)
 assert(!all.filter(n=>n.tipo==='acao_ambos').some(n=>n.gera_codigos_peca!.some(c=>c.includes('generica'))))
})
test('Stage4 internal pagination only when necessary, never initial or single hidden option; controls below circle in component',()=>{
 const nodes=Array.from({length:14},(_,i)=>({id:String(i),nome:String(i),tipo:'peca' as const}));assert.equal(mapPage(nodes,0,true).pages,1);assert.equal(mapPage(nodes.slice(0,9),0,false).pages,1);assert.equal(mapPage(nodes,0,false).nodes.length,8);assert.equal(mapPage(nodes,1,false).nodes.length,6)
})
test('Stage4 runtime catalog IDs are authoritative, legacy status does not block, projection never writes source data',()=>{
 const runtime=catalog.map((c,i)=>({...c,id:'existing-runtime:'+i})),before=JSON.stringify(runtime),leaves=mapTree(runtime).flatMap(walk).filter(n=>n.tipo==='peca')
 for(const leaf of leaves)assert.equal(leaf.id,runtime.find(c=>c.code===leaf.codigo_peca)!.id)
 assert.equal(JSON.stringify(runtime),before);assert.equal(mapTree(runtime).flatMap(walk).filter(n=>n.tipo==='acao_ambos').length,23)
})
