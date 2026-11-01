import test from 'node:test'
import assert from 'node:assert/strict'
import {openDatabase} from '../database.ts'
import {commercialFixture} from './fixtures/commercial.ts'
import {ComponentRepository} from '../components.ts'
import {calculate} from '../pricing-engine.ts'
import type {CommercialWorkspace} from '../../shared/commercial.ts'
import {componentMR,componentResult,resalePercent} from '../../src/component-presentation.ts'

for(const [factor,label]of [['1','0%'],['1.20','+20%'],['1.35','+35%'],['0.80','−20%'],['1.000001','+0,0001%'],['0','−100%']]as const)test(`Etapa D presents configured MR ${factor} as ${label} exactly`,()=>assert.equal(resalePercent(factor),label))
test('Etapa D absent/invalid MR never implies a neutral factor',()=>{for(const v of [null,undefined,'','NaN','1e2','-1','1.1234567'])assert.equal(resalePercent(v),null)})
function fixture(factor='1.2',price:string|null='100',quantity='2'){
 const db=openDatabase(':memory:'),f=commercialFixture(db),repo=new ComponentRepository(db),part=repo.save(f.at.id,{pieceId:f.item.id,name:'Componente QA',manualPrice:price,quantity,notes:''}),config={...f.config,resaleMultipliers:[{id:'mr',name:'MR QA',factor}]}
 const scenarios=f.scenarios.list(f.at.id),items=f.commercial.list(f.at.id,scenarios[0]!.id),components=repo.list(f.at.id),parameters=f.pricing.settings(f.at.id)
 const workspace:CommercialWorkspace={scenarios,selectedId:scenarios[0]!.id,items,components,settings:parameters.settings,revision:parameters.revision,configurationRevision:2,calculations:scenarios.map(s=>calculate(items,components,f.commercial.catalogs().items,s,config,parameters.settings))}
 return{db,f,part,config,workspace,piece:items[0]!,draft:{...part,enabled:true},configuration:{config,revision:2,updatedAt:''}}
}
for(const [price,quantity,expected]of [['100','2','240'],['100.01','2','240.1'],['100.01','0.25','30.0125'],['0','3','0']]as const)test(`Etapa D renders official component total ${price} × MR × ${quantity}, including unit ceiling and zero`,()=>{
 const t=fixture('1.2',price,quantity)
 try{assert.equal(t.workspace.calculations[0]!.lines.find(l=>l.id===t.part.id)!.total,expected);assert.deepEqual(componentResult(t.draft,t.piece,t.workspace,'current',false),{state:'current',text:null,value:expected});assert.equal(componentMR(t.workspace,t.configuration).label,'+20%');assert.equal(componentMR(t.workspace,null).label,'+20%')}finally{t.db.close()}
})
test('Etapa D pending inputs/parameters, persistence errors, null price, absent MR and exclusions do not show old or zero totals',()=>{
 const t=fixture()
 try{
  for(const draft of [{...t.draft,quantity:'3'},{...t.draft,manualPrice:null},{...t.draft,name:'Nova descrição'},{...t.draft,enabled:false}])assert.equal(componentResult(draft,t.piece,t.workspace,'current',false).state,'pending')
  assert.equal(componentResult(t.draft,t.piece,t.workspace,'pending',false).text,'Calculando…');assert.equal(componentResult(t.draft,t.piece,t.workspace,'error',false).text,'Valor não atualizado');assert.equal(componentResult(t.draft,t.piece,t.workspace,'current',true).text,'Valor não atualizado')
  const w=structuredClone(t.workspace);w.components[0]!.manualPrice=null;w.calculations[0]!.lines.find(l=>l.id===t.part.id)!.total=null
  assert.equal(componentResult({...t.draft,manualPrice:null},t.piece,w,'current',false).text,'Preço não informado')
  w.settings.mrId=null;assert.equal(componentMR(w,t.configuration).label,'Não configurado')
  w.components[0]!.manualPrice='100';w.calculations[0]!.lines.find(l=>l.id===t.part.id)!.factors={}
  assert.equal(componentResult(t.draft,t.piece,w,'current',false).text,'MR não configurado')
  w.scenarios[0]!.componentFlags[t.part.id]=false
  assert.deepEqual(componentResult({...t.draft,enabled:false},t.piece,w,'current',false),{state:'excluded',text:'Fora do orçamento',value:null})
  assert.equal(componentMR(t.workspace,{...t.configuration,config:{...t.config,resaleMultipliers:[{id:'mr',name:'Pendente',factor:null}]}}).label,'Não configurado')
 }finally{t.db.close()}
})

test('Etapa D an official calculation failure with valid MR is not mislabeled as missing MR',()=>{
 const t=fixture()
 try{const line=t.workspace.calculations[0]!.lines.find(l=>l.id===t.part.id)!;line.total=null;line.factors={};assert.equal(componentResult(t.draft,t.piece,t.workspace,'current',false,t.configuration).text,'Valor não atualizado');assert.equal(componentResult(t.draft,t.piece,t.workspace,'current',false,{...t.configuration,config:{...t.config,resaleMultipliers:[{id:'mr',name:'Pendente',factor:null}]}}).text,'MR não configurado')}finally{t.db.close()}
})

test('Stage3 incomplete component fields never claim an active calculation or silently replace a missing price with zero',()=>{
 const t=fixture()
 try{
  for(const p of [{...t.draft,name:''},{...t.draft,quantity:'0'},{...t.draft,manualPrice:'bad'}])assert.deepEqual(componentResult(p,t.piece,t.workspace,'current',false),{state:'incomplete',text:'Rascunho incompleto',value:null})
  assert.equal(componentResult({...t.draft,name:''},t.piece,t.workspace,'current',true).state,'error')
  const w=structuredClone(t.workspace);w.components[0]!.manualPrice=null;w.calculations[0]!.lines.find(l=>l.id===t.part.id)!.total=null
  assert.equal(componentResult({...t.draft,manualPrice:null},t.piece,w,'current',false).text,'Preço não informado')
 }finally{t.db.close()}
})
