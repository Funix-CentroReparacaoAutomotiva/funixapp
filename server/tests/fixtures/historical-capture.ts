import {historicalCodaColumns as c,historicalCodaTables as t} from '../../historical-coda-capture.ts'
const id=(s:string)=>'i-synthetic-'+s
const ref=(s:string,table:string,name:string)=>({type:'ref',rowId:id(s),targetTableId:table,name})
const currency=(scalar:number)=>({type:'currency',code:'BRL',scalar})
function row(rowId:string,columns:Record<string,string>,fields:Record<string,unknown>){
  return {rowId:id(rowId),values:Object.fromEntries(Object.entries(fields).map(([key,value])=>[columns[key],{value}]))}
}
function table(tableId:string,rows:ReturnType<typeof row>[]){return {tableId,pages:[{offset:0,rows,totalRows:rows.length,hasMore:false}]}}
export function historicalCapture(){
  const budget='SYNTHETIC-BUDGET',diag=budget+'_A',service=diag+'_SA.1'
  return {format:'funix-historical-coda-capture-v1',documentId:'2zsjI-nqWr',tables:{
    budget:table(t.budget,[row('budget',c.budget,{number:budget,attendance:ref('at',t.attendance,'AT-SYNTHETIC'),status:ref('status','grid-synthetic-status','Consentido'),date:{type:'dt',epoch:1767225600},days:7,color:'',risk:'',pricing:'Padrão',services:currency(100),netServices:currency(99.99999999999999),parts:currency(120.00000000000001),discount:currency(1e-13),total:currency(220),beforeDiscount:currency(220),diagnosisRefs:[ref('diag',t.diagnoses,diag)],serviceRefs:[ref('service',t.services,service)],componentRefs:[ref('component',t.components,'Item fictício')],p3:77.73333333333333,t3:233.2,p6:'',t6:'',p9:'',t9:'',p12:'',t12:''})]),
    attendance:table(t.attendance,[row('at',c.attendance,{number:'AT-SYNTHETIC'})]),
    diagnoses:table(t.diagnoses,[row('diag',c.diagnoses,{budget,id:diag,code:'A',piece:'Peça fictícia',position:'Dianteiro',damage:'Riscado',summary:'Riscado (Moderado)',services:currency(100),parts:currency(120)})]),
    services:table(t.services,[row('service',c.services,{budget,id:service,parent:diag,code:'A.1',name:'Pintura',dimension:'Completa',quantity:1,unit:currency(100),total:currency(100),energy:3})]),
    components:table(t.components,[row('component',c.components,{budget,parent:diag,code:'A.i',name:'Item fictício',quantity:1,unit:currency(120),total:currency(120)})]),
    stages:table(t.stages,[1,2,3].map(n=>row('stage'+n,c.stages,{budget,parent:diag,id:service+'_E'+(n===3?2:n),code:'A.1.'+(n===3?2:n),service:'Pintura',name:'Etapa '+n,energy:1,amount:currency(100/3),category:{type:'slate',root:{children:[{children:[{text:'Preparação técnica'}]}]}}}))),
  }}
}
