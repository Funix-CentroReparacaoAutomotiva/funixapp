import test from 'node:test'
import assert from 'node:assert/strict'
import type { CatalogItem,DiagnosisItem,Scenario } from '../../shared/commercial.ts'
import type { ComponentItem,PricingConfig } from '../../shared/pricing.ts'
import {calculate,negotiation} from '../pricing-engine.ts'
import {Q} from '../exact.ts'

export function calculationFixture(){
 const catalog=[['piece','peca','Peça'],['svc','servico','Serviço'],['dim','dimensao','Dimensão']].map(([id,kind,name])=>({id,kind,name,serviceId:kind==='dimensao'?'svc':null,code:kind==='peca'?'provided-code':null,status:'validado',active:true,source:'operador',suggestion:false,side:'',revision:1,createdAt:'test',updatedAt:'test'})) as CatalogItem[]
 const items:DiagnosisItem[]=[{id:'p',atendimentoId:'at',pieceId:'piece',diagnosisId:null,notes:'',enabled:true,revision:1,createdAt:'test',updatedAt:'test',services:[{id:'l',serviceId:'svc',dimensionId:'dim',quantity:'3',enabled:true}]}]
 const scenario:Scenario={id:'a',atendimentoId:'at',name:'A',position:1,revision:1,pieceFlags:{p:true},serviceFlags:{l:true},componentFlags:{}}
 const config:PricingConfig={tables:[{id:'table',name:'Tabela sintética',factor:'1'}],colors:[{id:'color',name:'Cor sintética',factor:'1'}],risks:[{id:'risk',name:'Risco sintético',factor:'1'}],capacity:'4',conditions:'Condições sintéticas',services:[{serviceId:'svc',base:'100.01',dimensions:[{dimensionId:'dim',fd:'1',stages:[{id:'step',name:'Etapa sintética',dimension:'Técnica',baseEnergy:'2',dimensionEnergy:'3'}]}]}],specialPrices:[]}
 const settings={tableId:'table',colorId:'color',riskId:'risk'},components:ComponentItem[]=[]
 return {catalog,items,scenario,config,settings,components,run:()=>calculate(items,components,catalog,scenario,config,settings)}
}

test('approved V0.9 R05: unit 100.01 ceilings to 100.05 before quantity; energy additive and global days ceiling',()=>{
 const f=calculationFixture(),c=f.run()
 assert.deepEqual(c.errors,[]);assert.equal(c.lines[0]!.unit,'100.05');assert.equal(c.total,'300.15');assert.equal(c.energy,'15');assert.equal(c.days,'4')
 f.config.tables[0]!.factor='2';assert.equal(f.run().energy,'15')
})
test('normal factors multiply exactly once; exact special key bypasses all factors only in its own table',()=>{
 const f=calculationFixture();f.items[0]!.services[0]!.quantity='2';f.config.services[0]!.base='10';f.config.services[0]!.dimensions[0]!.fd='1.5';f.config.tables[0]!.factor='1.2';f.config.colors[0]!.factor='1.1';f.config.risks[0]!.factor='1.3'
 assert.equal(f.run().lines[0]!.unit,'25.75')
 f.config.specialPrices=[{tableId:'other',serviceId:'svc',dimensionId:'dim',unit:'50.001'}]
 assert.equal(f.run().lines[0]!.path,'normal')
 f.config.specialPrices[0]!.tableId='table';f.config.services[0]!.base=null;f.config.services[0]!.dimensions[0]!.fd=null;f.config.colors=[];f.config.tables[0]!.factor=null;f.config.risks=[]
 const c=f.run();assert.deepEqual(c.errors,[]);assert.equal(c.lines[0]!.unit,'50.05');assert.equal(c.total,'100.1');assert.equal(c.energy,'10')
 f.config.specialPrices.push({...f.config.specialPrices[0]!});assert(f.run().errors.some(e=>e.includes('duplicado')))
})
test('manual components keep explicit zero; missing is pending; FCT is individual and no negotiation touches components',()=>{
 const f=calculationFixture();f.components.push({id:'c',atendimentoId:'at',pieceId:'p',name:'Componente sintético',quantity:'2',manualPrice:'0',fct:'1.2',notes:'',revision:1});f.scenario.componentFlags.c=true
 assert.equal(f.run().componentSubtotal,'0')
 f.components[0]!.manualPrice=null;assert.equal(f.run().total,null);assert(f.run().errors.some(e=>e.includes('Preço manual')))
 f.components[0]!.manualPrice='10.01';assert.equal(f.run().componentSubtotal,'24.1')
 const c=calculate(f.items,f.components,f.catalog,f.scenario,f.config,f.settings,{mode:'discount',value:'10',acknowledgeResidual:false})
 assert.equal(c.total,'314.25');assert.equal(c.componentSubtotal,'24.1');assert.equal(c.discount,'10')
})
test('discount and lower target preserve original service prices; modes cannot be combined',()=>{
 const f=calculationFixture();const c=calculate(f.items,[],f.catalog,f.scenario,f.config,f.settings,{mode:'adjust',value:'250',acknowledgeResidual:false})
 assert.equal(c.discount,'50.15');assert.equal(c.lines[0]!.unit,'100.05');assert.equal(c.lines[0]!.finalUnit,'100.05');assert.equal(c.total,'250')
 assert.throws(()=>negotiation({mode:'none',value:'10'}))
 assert.throws(()=>negotiation({mode:'discount',value:'10',adjust:'20'}))
 const invalid=calculate(f.items,[],f.catalog,f.scenario,f.config,f.settings,{mode:'discount',value:'500',acknowledgeResidual:false});assert(invalid.errors.some(e=>e.includes('supera')))
})
test('positive proportional adjustment stores actual unit prices; residual <=0.50 requires consent, larger blocks',()=>{
 const f=calculationFixture();f.config.services[0]!.base='1';f.items[0]!.services[0]!.quantity='40'
 const calculateDeal=(value:string,acknowledgeResidual:boolean)=>calculate(f.items,[],f.catalog,f.scenario,f.config,f.settings,{mode:'adjust',value,acknowledgeResidual})
 assert(calculateDeal('40.50',false).errors.some(e=>e.includes('ciência')))
 const accepted=calculateDeal('40.50',true);assert.deepEqual(accepted.errors,[]);assert.equal(accepted.residual,'0.5');assert.equal(accepted.lines[0]!.finalUnit,'1');assert.equal(accepted.total,'40')
 assert(calculateDeal('40.60',true).errors.some(e=>e.includes('superior')))
 f.config.services[0]!.base='100';f.items[0]!.services=[{id:'l',serviceId:'svc',dimensionId:'dim',quantity:'1',enabled:true},{id:'l2',serviceId:'svc',dimensionId:'dim',quantity:'2',enabled:true}];f.scenario.serviceFlags.l2=true
 const exact=calculateDeal('330',false);assert.equal(exact.total,'330');assert.deepEqual(exact.lines.map(l=>l.finalUnit),['110','110'])
})
test('fractional quantities retain subcent totals without hidden rounding; disabled parents produce no price or energy',()=>{
 const f=calculationFixture();f.config.services[0]!.base='0.01';f.items[0]!.services[0]!.quantity='0.25'
 const c=f.run();assert.equal(c.total,'0.0125');assert.equal(c.energy,'1.25');assert.equal(Q.from('0.1').add(Q.from('0.2')).toString(),'0.3')
 f.scenario.pieceFlags.p=false;f.config.services=[]
 const off=f.run();assert.equal(off.energy,'0');assert(!off.errors.some(e=>e.includes('Preço base')));assert.equal(f.scenario.serviceFlags.l,true)
 f.scenario.pieceFlags.p=true;assert(f.run().errors.some(e=>e.includes('Preço base')))
})
test('missing steps and capacity block emission without faking prices or losing valid partial totals',()=>{
 const f=calculationFixture();f.config.services[0]!.dimensions[0]!.stages=[]
 const c=f.run();assert.equal(c.total,'300.15');assert.equal(c.days,null);assert(c.errors.some(e=>e.includes('Etapas')))
 f.config.services[0]!.dimensions[0]!.stages=[{id:'x',name:'X',dimension:'X',baseEnergy:'0',dimensionEnergy:'0'}];f.config.capacity=null
 assert(f.run().errors.some(e=>e.includes('Capacidade')))
})

test('last-line compensation never becomes negative when other rounded lines already exceed target',()=>{
 const f=calculationFixture();f.config.services[0]!.base='0.05'
 f.items[0]!.services=[{id:'l',serviceId:'svc',dimensionId:'dim',quantity:'1000',enabled:true},{id:'l2',serviceId:'svc',dimensionId:'dim',quantity:'1',enabled:true}];f.scenario.serviceFlags.l2=true
 const c=calculate(f.items,[],f.catalog,f.scenario,f.config,f.settings,{mode:'adjust',value:'50.06',acknowledgeResidual:true})
 assert.equal(c.lines[1]!.finalUnit,'0');assert(c.errors.some(e=>e.includes('superior')))
})
