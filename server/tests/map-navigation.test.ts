import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {hierarchy,hierarchyPieces} from '../hierarchy.ts'
import {canonicalMap,mapChoicePosition,mapPage} from '../../src/map-navigation.ts'
import type {MapNode} from '../../src/map-navigation.ts'
import type {CatalogItem} from '../../shared/commercial.ts'
const catalog:CatalogItem[]=hierarchyPieces().map(p=>({id:'v2:'+p.code,kind:'peca',code:p.code,name:p.name,side:p.side,active:true,status:'proposta',source:'hierarquia-v2',suggestion:p.suggestion,serviceId:null,revision:1,createdAt:'',updatedAt:''}))
function csv(name:string){
 const text=readFileSync(new URL('../../docs/referencias/issue28/'+name,import.meta.url),'utf8').replace(/^\uFEFF/,'');const rows:string[][]=[];let row:string[]=[],field='',quoted=false
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++}else quoted=!quoted}else if(!quoted&&(c===';'||c==='\n')){row.push(field);field='';if(c==='\n'){rows.push(row);row=[]}}else if(c!=='\r')field+=c}
 assert(!quoted);if(field||row.length){row.push(field);rows.push(row)}const headers=rows.shift()!;return rows.map(r=>Object.fromEntries(headers.map((k,i)=>[k,r[i]??''])))
}
const walk=(node:MapNode):MapNode[]=>[node,...(node.itens??[]).flatMap(walk)]
function inventory(roots:MapNode[]){const entries:{node:MapNode;path:string[]}[]=[];function visit(n:MapNode,path:string[]){const p=[...path,n.nome];if(n.tipo==='peca')entries.push({node:n,path:p});n.itens?.forEach(c=>visit(c,p))}roots.forEach(n=>visit(n,[]));return entries}

test('Issue28 exactly 163 original identities have one canonical path matching audited matrix with only authorized D01/D02 overrides',()=>{
 const before=JSON.stringify({catalog,hierarchy}),roots=canonicalMap(catalog),entries=inventory(roots),reference=csv('FUNIX_MATRIZ_163_PROPOSTA.csv')
 assert.equal(entries.length,163);assert.equal(new Set(entries.map(e=>e.node.codigo_peca)).size,163);assert.equal(new Set(entries.map(e=>JSON.stringify(e.path))).size,163)
 assert.deepEqual(entries.map(e=>e.node.codigo_peca).sort(),catalog.map(c=>c.code).sort())
 for(const r of reference){let expected=r.caminho_canonico_proposto!.split(' > ');if(r.codigo!.startsWith('coluna_generica__'))expected=[r.regiao_proposta!,'Estrutura lateral','Colunas','Coluna (posição não especificada)'];if(r.codigo!.startsWith('caixa_roda_generica__'))expected=[r.regiao_proposta!,'Caixa de roda','Posição não especificada'];const actual=entries.find(e=>e.node.codigo_peca===r.codigo)!;assert.deepEqual(actual.path,expected);assert.equal(actual.node.id,catalog.find(c=>c.code===r.codigo)!.id)}
 assert.equal(JSON.stringify({catalog,hierarchy}),before)
})
test('Issue28 seven existing visual regions, thirteen direct lateral choices and provisional codes stay distinct and reachable',()=>{
 const roots=canonicalMap(catalog);assert.deepEqual(roots.map(n=>n.regionKey).sort(),['frente','estrutura-dianteira','motorista','passageiro','traseira','estrutura-traseira','teto'].sort())
 for(const side of ['motorista','passageiro']){const root=roots.find(n=>n.regionKey===side)!;assert.equal(root.itens!.length,13);assert.equal(mapPage(root.itens!.length,0,true).end,13);for(const e of inventory([root]))assert.equal(catalog.find(c=>c.code===e.node.codigo_peca)!.side,side);assert(!walk(root).slice(1).some(n=>n.nome==='Motorista'||n.nome==='Passageiro'||n.nome==='Coluna (genérica)'))}
 const entries=inventory(roots);assert.equal(entries.filter(e=>e.node.nome==='Coluna (posição não especificada)').length,2);assert.equal(entries.filter(e=>e.node.nome==='Posição não especificada').length,2)
 for(const e of entries.filter(e=>/^(farol|farol_milha|alojamento_farol|moldura_farol_milha)__/.test(e.node.codigo_peca!)))assert.equal(e.path[0],'Frente')
})
test('Issue28 all 23 audited Ambos actions contain the exact two existing real codes and preserve geometry for side/position',()=>{
 const roots=canonicalMap(catalog),nodes=roots.flatMap(walk),actions=nodes.filter(n=>n.tipo==='acao_ambos'),reference=csv('FUNIX_AMBOS_PROPOSTOS.csv');assert.equal(actions.length,23)
 for(const r of reference){const action=actions.find(a=>JSON.stringify(a.gera_codigos_peca)===JSON.stringify([r.codigo_1,r.codigo_2]))!;assert(action);const parent=nodes.find(n=>n.itens?.includes(action))!;assert(parent.itens!.some(n=>n.codigo_peca===r.codigo_1));assert(parent.itens!.some(n=>n.codigo_peca===r.codigo_2));assert(!action.gera_codigos_peca!.some(c=>c.includes('generica')))
  const first=parent.itens!.find(n=>(n as MapNode).choice==='first')!,second=parent.itens!.find(n=>(n as MapNode).choice==='second')!;const a=mapChoicePosition(parent,action,0,3),f=mapChoicePosition(parent,first,0,3),s=mapChoicePosition(parent,second,0,3)
  if(r.eixo==='Lado'){assert(Number.parseFloat(a.top)<Number.parseFloat(f.top));assert(Number.parseFloat(f.left)<Number.parseFloat(s.left))}else{assert(Number.parseFloat(f.top)<Number.parseFloat(s.top));assert.equal(a.left,r.regiao==='Motorista'?'80%':'20%')}
 }
})
test('Issue28 inactive, uncoded or missing catalog identity never enables an invalid Ambos; no operator records or names are changed',()=>{
 const code='roda_dianteira__motorista',changed=catalog.map(c=>c.code===code?{...c,active:false}:c),before=JSON.stringify(changed),nodes=canonicalMap(changed).flatMap(walk)
 assert(!nodes.some(n=>n.tipo==='acao_ambos'&&n.gera_codigos_peca!.includes(code)));assert.equal(nodes.filter(n=>n.tipo==='peca').length,163);assert.equal(JSON.stringify(changed),before)
 const missing=canonicalMap(catalog.filter(c=>c.code!==code)).flatMap(walk);assert(!missing.some(n=>n.tipo==='acao_ambos'&&n.gera_codigos_peca!.includes(code)))
})
test('Issue28 first layers and eight choices never paginate; necessary internal pages balance remaining entries rather than hide one',()=>{
 for(const count of [1,7,8,13,20])assert.equal(mapPage(count,0,true).pages,1)
 assert.equal(mapPage(8,0,false).pages,1)
 for(const total of [9,10,15,16,17,25]){let visited:number[]=[];const first=mapPage(total,0,false);for(let i=0;i<first.pages;i++){const p=mapPage(total,i,false);assert(p.end-p.start>1);assert(p.end-p.start<=8);visited.push(...Array.from({length:p.end-p.start},(_,n)=>p.start+n))}assert.deepEqual(visited,Array.from({length:total},(_,i)=>i))}
})
test('Issue28 SVG geometry is unchanged while structural hit areas receive independent keys',()=>{
 const svg=readFileSync(new URL('../../src/assets/car-map.svg',import.meta.url),'utf8'),geometry=[...svg.matchAll(/<path[^>]* d="([^"]+)"/g)].map(m=>m[1]).join('\n')
 assert.equal(createHash('sha256').update(geometry).digest('hex'),'027ff125aa28bbee09192e950c6f04e28f4774d350bf83e9a7f8126d4d66fd25')
 const keys=[...svg.matchAll(/data-region="([^"]+)"/g)].map(m=>m[1]);assert.equal(keys.length,7);assert.equal(new Set(keys).size,7)
})
