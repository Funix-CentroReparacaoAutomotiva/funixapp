import type {DatabaseSync} from 'node:sqlite'
import {AtendimentoRepository} from '../../atendimentos.ts'
import {CommercialRepository} from '../../commercial.ts'
import {ScenarioRepository} from '../../scenarios.ts'
import {PricingConfigurationRepository} from '../../pricing-config.ts'

// Explicit synthetic test data only. Never loaded by application startup.
export function commercialFixture(db:DatabaseSync,withMR=true){
 const atendimentos=new AtendimentoRepository(db),commercial=new CommercialRepository(db),scenarios=new ScenarioRepository(db),pricing=new PricingConfigurationRepository(db)
 const at=atendimentos.create({phone:'123',name:'QA João — ação, çãé — SINTÉTICO',plate:'QA-000',notes:'Somente teste'})
 const piece=commercial.catalogs().items.find(p=>p.code==='capo')!;commercial.saveCatalog({revision:1,status:'validado'},piece.id)
 const service=commercial.saveCatalog({kind:'servico',name:'Serviço sintético',status:'validado'}),dimension=commercial.saveCatalog({kind:'dimensao',name:'Dimensão sintética',serviceId:service.id,status:'validado'})
 const p=commercial.add(at.id,{pieceCodes:['capo']})[0]!
 const item=commercial.updateDiagnosis(at.id,p.id,{revision:p.revision,services:[{serviceId:service.id,dimensionId:dimension.id,quantity:'3'}]})
 const config={...(withMR?{resaleMultipliers:[{id:'mr',name:'MR sintético',factor:'2'}]}:{}),tables:[{id:'table',name:'Tabela sintética',factor:'1'}],colors:[{id:'color',name:'Cor sintética',factor:'1'}],risks:[{id:'risk',name:'Risco sintético',factor:'1'}],capacity:'4',conditions:'Condições de homologação sintética. Não executar serviço.',services:[{serviceId:service.id,colorFactorEnabled:true,discountable:true,billable:true,base:'100.01',dimensions:[{dimensionId:dimension.id,fd:'1',stages:[{id:'step',name:'Etapa sintética',dimension:'Técnica',baseEnergy:'2',dimensionEnergy:'3'}]}]}],specialPrices:[]}
 pricing.save({revision:1,config})
 pricing.saveSettings(at.id,{revision:pricing.settings(at.id).revision,tableId:'table',colorId:'color',riskId:'risk',...(withMR?{mrId:'mr'}:{})})
 const scenario=scenarios.list(at.id)[0]!
 return {at,atendimentos,commercial,scenarios,pricing,item,service,dimension,scenario,config}
}
