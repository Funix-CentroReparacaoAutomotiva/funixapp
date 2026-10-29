import type {DatabaseSync} from 'node:sqlite'
import {commercialFixture} from './commercial.ts'
import {ComponentRepository} from '../../components.ts'
export const performanceCases=[{name:'small',pieces:1,services:2,scenarios:1,components:3},{name:'medium',pieces:20,services:3,scenarios:3,components:20},{name:'stress',pieces:80,services:4,scenarios:10,components:80}] as const
// Synthetic only; never called by application startup.
export function performanceFixture(db:DatabaseSync,spec:typeof performanceCases[number]){
 const f=commercialFixture(db),components=new ComponentRepository(db)
 for(const p of f.commercial.catalogs().items.filter(p=>p.kind==='peca'&&p.code&&p.code!=='capo'&&p.active).slice(0,spec.pieces-1))f.commercial.add(f.at.id,{pieceCodes:[p.code!]})
 const items=f.commercial.list(f.at.id).map(p=>f.commercial.updateDiagnosis(f.at.id,p.id,{revision:p.revision,services:Array.from({length:spec.services},()=>({serviceId:f.service.id,dimensionId:f.dimension.id,quantity:'1'}))}))
 for(let i=0;i<spec.components;i++)components.save(f.at.id,{pieceId:items[i<3?0:(i-2)%items.length]!.id,name:'Componente sintético '+i,quantity:'1',manualPrice:'10',notes:''})
 for(let i=1;i<spec.scenarios;i++)f.scenarios.create(f.at.id,{name:'Cenário QA '+i,duplicateFrom:f.scenario.id,sourceRevision:f.scenarios.list(f.at.id)[0]!.revision})
 return {...f,components}
}
