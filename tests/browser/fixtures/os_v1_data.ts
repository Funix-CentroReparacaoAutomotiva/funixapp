import {renderOrderV1} from '../../../server/os-template.ts'
import type {WorkOrder} from '../../../shared/work-order.ts'
import type {StageCluster} from '../../../shared/stage-clusters.ts'

const count=Number(process.argv[2]??4)
if(!Number.isInteger(count)||count<1||count>80)throw Error('invalid piece count')
const stress=process.argv[3]==='stress'
const categories:StageCluster[]=['Preparação técnica','Correção estrutural','Pintura e acabamento','Estética e revitalização','Serviços complementares']
const diagnostics:WorkOrder['scope']['diagnostics']=[]
const lines:WorkOrder['scope']['lines']=[]
for(let i=0;i<count;i++){
 const pieceId='synthetic-piece-'+i
 diagnostics.push({pieceId,pieceName:'Peça sintética '+String(i+1).padStart(2,'0'),
   diagnosis:'Diagnóstico sintético '+(i+1),intensity:'leve',notes:'Conferir montagem após desmontagem.'})
 lines.push({id:'s-'+i,pieceId,kind:'service',pieceName:diagnostics[i]!.pieceName,name:'Reparação técnica',diagnosis:'Avaria externa',dimension:'',quantity:'1',notes:'',
   stages:(stress?categories:categories.slice(0,3)).map(cluster=>({name:'Etapa de '+cluster,dimension:i%2===0?'Parcial':'M',cluster}))})
 if(i%2===0)lines.push({id:'c-'+i,pieceId,kind:'component',pieceName:diagnostics[i]!.pieceName,
   name:'Presilha '+(i+1),diagnosis:'',dimension:'',quantity:'4',notes:'',stages:[]})
}
if(stress){
 const first=diagnostics[0]!
 first.notes=Array.from({length:70},(_,i)=>'Nota'+String(i).padStart(3,'0')+' verificar montagem e alinhamento.').join(' ')
 for(let i=0;i<20;i++)lines.push({id:'stress-c-'+i,pieceId:first.pieceId,kind:'component',pieceName:first.pieceName,
   name:'Componente QA'+String(i).padStart(2,'0')+' com descrição extensa',diagnosis:'',dimension:'',quantity:'12',notes:'',stages:[]})
}
const order:WorkOrder={
 id:'synthetic-os',number:'OS-000142',atendimentoId:'synthetic-at',budgetVersionId:'synthetic-budget',
 budgetNumber:'OR-000100',budgetLabel:'Principal',createdAt:'2026-11-16T13:00:00.000Z',
 authorization:{confirmedAt:'2026-11-16T13:00:00.000Z',source:'authenticated-session-confirmation',operatorId:null},
 scope:{customer:{name:'Cliente sintético'},vehicle:{description:count===4?'Honda City EXL 21/22':'Chevrolet Trailblazer Premier 2.8 Turbo Diesel 2023/2024',plate:'FXN2A26'},
 diagnostics,lines,deadlineDays:7,deliveryDate:'2026-11-19'},revision:1
}
process.stdout.write(JSON.stringify(renderOrderV1(order)))
