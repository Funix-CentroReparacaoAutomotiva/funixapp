import {preflightHistoricalBudget} from './historical-budget-preflight.ts'
import {ServiceError} from './errors.ts'

/** Verified column IDs of the production ERP schema, not row/customer data.
 * Input is a complete filtered capture from the read-only connector.
 * This module does not contact Coda or write to any database.
 */
export const historicalCodaTables={
  budget:'grid-LgsVNgYj3J',attendance:'grid-eGvJhrlDTH',diagnoses:'grid-xqB705Hupo',
  services:'grid-Qw63i1ww0v',components:'grid-SRAMUtadEm',stages:'grid-DpdMZC56vP',
} as const
const docId='2zsjI-nqWr'
export const historicalCodaColumns={
  budget:{number:'c-8dKWwlT8ZU',attendance:'c-L-3Ddv7cPI',status:'c-8CkFrLk2FD',date:'c-m-MHZsEN_-',days:'c-Y0oDFmhgPz',color:'c-LfAfaSz39D',risk:'c-gJ7EWUlQBB',pricing:'c-lCUNw9u_TW',services:'c-gkKb-BU_gM',netServices:'c-g0RphQsJ5W',parts:'c-UtBZMA2C-K',discount:'c-nIdSsFKv2s',total:'c-bI43StABJ6',beforeDiscount:'c-kftiP2UFF8',diagnosisRefs:'c-T6-tGr-Vtl',serviceRefs:'c-prWVrMGxr4',componentRefs:'c-KgiTxrroYj',p3:'c-isxSKJUwvw',t3:'c-xLFMY0w0Aq',p6:'c-ipvEOJxlDt',t6:'c-PjBWLpC8IF',p9:'c-RdmpwcXzXo',t9:'c-L3e1nNM5uF',p12:'c-Fh0P4E3S3b',t12:'c-_UFIaTCKRZ'},
  attendance:{number:'c-Zorfa5ARUf'},
  diagnoses:{budget:'c-w2_-fVKlI0',id:'c-lCwU0oLhur',code:'c-R7w3HkhKw3',piece:'c-zLhKSzncKq',position:'c-S5U_QlfAWB',damage:'c-d9qe15TkUO',summary:'c-PGh2aZoY9y',services:'c-kgvJaqQDBw',parts:'c-n96AK6G5Er'},
  services:{budget:'c-rSB8OUf47K',id:'c-Jc4MOnyeC3',parent:'c-NJWzNcgJcG',code:'c-Kykoat-o4D',name:'c-VDEI0YQ022',dimension:'c-YuycXlEplJ',quantity:'c-QGSYEIsqFO',unit:'c-Btitch4W-Q',total:'c--zNdEAz-0A',energy:'c-AaI0rv35lQ'},
  components:{budget:'c-UbCsUBvfub',parent:'c-VRDG9Fw2bL',code:'c-66YmWSxPLv',name:'c-ymWIoyMkBQ',quantity:'c-5Xs0O4spD1',unit:'c-tu8xYokxaL',total:'c-uLzhQGuYTJ'},
  stages:{budget:'c-a6C5hdquVw',parent:'c-bTXWct3GGM',id:'c-qQ6AsOBh88',code:'c-e6LFWo7OXe',service:'c-bdxt3_3M5k',name:'c-Jcu9eVnDbj',energy:'c-mQC90pf2kc',amount:'c-w7tMahM1PY',category:'c-5z-H9tdsdn'},
} as const
type Row={rowId:string;values:Record<string,unknown>}
type Kind=keyof typeof historicalCodaTables
function fail(reason:string):never{
  throw new ServiceError(422,'HISTORICAL_CODA_CAPTURE_INVALID','Captura histórica inválida: '+reason)
}
function object(v:unknown):Record<string,unknown>{
  if(!v||typeof v!=='object'||Array.isArray(v))return fail('objeto esperado')
  return v as Record<string,unknown>
}
function text(v:unknown):string{
  if(typeof v!=='string'||!v.trim())return fail('texto de origem ausente')
  return v
}
function nullable(v:unknown):string|null{return v===null||v===''?null:text(v)}
function cell(r:Row,c:string):unknown{
  const box=object(r.values[c])
  if(!Object.hasOwn(box,'value'))return fail('célula ausente')
  return box.value
}
function ref(v:unknown,table?:string){
  const x=object(v)
  if(x.type!=='ref'||typeof x.targetTableId!=='string'||(table&&x.targetTableId!==table)||typeof x.rowId!=='string'||!/^i-[A-Za-z0-9_-]+$/.test(x.rowId))return fail('referência física inválida')
  return {id:x.rowId,name:text(x.name)}
}
function allRows(v:unknown,kind:Kind):Row[]{
  const capture=object(v)
  if(capture.tableId!==historicalCodaTables[kind]||!Array.isArray(capture.pages)||!capture.pages.length||capture.pages.length>40)return fail('tabela/paginação '+kind)
  const rows:Row[]=[]
  let total:number|undefined
  for(const [i,page] of capture.pages.entries()){
    const p=object(page)
    if(p.offset!==rows.length||!Array.isArray(p.rows)||p.rows.length>100||(!p.rows.length&&capture.pages.length>1)||typeof p.totalRows!=='number'||!Number.isSafeInteger(p.totalRows)||p.totalRows<0||p.totalRows>4000||p.hasMore!==(i<capture.pages.length-1))return fail('página incompleta '+kind)
    if(total!==undefined&&p.totalRows!==total)return fail('contagem mudou '+kind)
    total=p.totalRows
    for(const item of p.rows){
      const r=object(item)
      if(typeof r.rowId!=='string'||!/^i-[A-Za-z0-9_-]+$/.test(r.rowId))return fail('linha física ausente')
      rows.push({rowId:r.rowId,values:object(r.values)})
    }
  }
  if(rows.length!==total||new Set(rows.map(r=>r.rowId)).size!==rows.length)return fail('linhas ausentes/duplicadas '+kind)
  return rows
}
function refsMatch(value:unknown,table:string,rows:Row[]){
  const values=value===null||value===''?[]:Array.isArray(value)?value:[value]
  const ids=values.map(v=>ref(v,table).id).sort()
  if(JSON.stringify(ids)!==JSON.stringify(rows.map(r=>r.rowId).sort()))return fail('referências do orçamento divergentes')
}
function scalar(v:unknown):number{
  if(typeof v!=='number'){
    const x=object(v)
    if(x.type!=='num'&&!(x.type==='currency'&&x.code==='BRL'))return fail('número/BRL esperado')
    v=x.scalar
  }
  if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1e10)return fail('número fora dos limites')
  return v
}
/** Coda connector supplies binary numbers. Cent rounding converts declared display
 * amounts; strictly reject sub-cent values except installment formulas and noise.
 * All subsequent arithmetic uses the exact preflight engine.
 */
function money(v:unknown,formula=false):string{
  const n=scalar(v),cents=Math.round((n+Number.EPSILON)*100)
  if(!formula&&Math.abs(n-cents/100)>Math.max(1e-8,Math.abs(n)*Number.EPSILON*4))return fail('valor monetário não representável em centavos')
  return (BigInt(cents)/100n).toString()+'.'+(BigInt(cents)%100n).toString().padStart(2,'0')
}
function decimal(v:unknown,places:number):string{
  const n=scalar(v),s=n.toFixed(places)
  if(Math.abs(n-Number(s))>Math.max(1e-9,Math.abs(n)*Number.EPSILON*4))return fail('precisão numérica não representável')
  return s.replace(/(\.\d*?[1-9])0+$/,'$1').replace(/\.0+$/,'')
}
function epoch(v:unknown):string{
  const x=object(v)
  if(x.type!=='dt'||typeof x.epoch!=='number'||!Number.isSafeInteger(x.epoch)||Math.abs(x.epoch)>253402300799)return fail('data de origem inválida')
  return new Date(x.epoch*1000).toISOString()
}
function category(v:unknown):string|null{
  if(v===null||typeof v==='string')return nullable(v)
  const x=object(v)
  if(x.type!=='slate')return fail('categoria de etapa desconhecida')
  const root=object(x.root)
  if(!Array.isArray(root.children))return fail('categoria de etapa inválida')
  const pieces:string[]=[]
  for(const raw of root.children){
    const line=object(raw)
    if(!Array.isArray(line.children))return fail('categoria de etapa inválida')
    for(const rawChild of line.children)pieces.push(text(object(rawChild).text))
  }
  return nullable(pieces.join(' '))
}
function onePass(raw:unknown){
  const x=object(raw)
  if(x.documentId!==docId||x.format!=='funix-historical-coda-capture-v1')return fail('documento/formato')
  const tables=object(x.tables),c=historicalCodaColumns,t=historicalCodaTables
  const b=allRows(tables.budget,'budget'),a=allRows(tables.attendance,'attendance'),d=allRows(tables.diagnoses,'diagnoses'),s=allRows(tables.services,'services'),p=allRows(tables.components,'components'),e=allRows(tables.stages,'stages')
  if(b.length!==1||a.length!==1)return fail('orçamento/Atendimento não inequívoco')
  const budget=b[0]!,attendance=a[0]!,number=text(cell(budget,c.budget.number))
  const attendanceRef=ref(cell(budget,c.budget.attendance),t.attendance)
  if(attendanceRef.id!==attendance.rowId||attendanceRef.name!==text(cell(attendance,c.attendance.number)))return fail('Atendimento divergente')
  refsMatch(cell(budget,c.budget.diagnosisRefs),t.diagnoses,d)
  refsMatch(cell(budget,c.budget.serviceRefs),t.services,s)
  refsMatch(cell(budget,c.budget.componentRefs),t.components,p)
  const check=(r:Row,col:string)=>{if(text(cell(r,col))!==number)fail('registro de outro orçamento')}
  function index(rows:Row[],column:string){
    const map=new Map<string,Row>()
    for(const r of rows){
      const id=text(cell(r,column))
      if(map.has(id))return fail('identificador de negócio pai duplicado')
      map.set(id,r)
    }
    return map
  }
  const di=index(d,c.diagnoses.id),si=index(s,c.services.id)
  const find=(m:Map<string,Row>,v:unknown)=>{const r=m.get(text(v));if(!r)return fail('pai ausente');return r}
  const diagnoses=d.map(r=>{
    check(r,c.diagnoses.budget)
    const damage=nullable(cell(r,c.diagnoses.damage)),summary=nullable(cell(r,c.diagnoses.summary))
    const intensity=damage&&summary?.startsWith(damage+' (')&&summary.endsWith(')')?summary.slice(damage.length+2,-1):null
    return {rowId:r.rowId,code:text(cell(r,c.diagnoses.code)),piece:text(cell(r,c.diagnoses.piece)),position:nullable(cell(r,c.diagnoses.position)),damage,intensity,services:money(cell(r,c.diagnoses.services)),components:money(cell(r,c.diagnoses.parts))}
  })
  const services=s.map(r=>{
    check(r,c.services.budget)
    return {rowId:r.rowId,diagnosisRowId:find(di,cell(r,c.services.parent)).rowId,code:text(cell(r,c.services.code)),service:text(cell(r,c.services.name)),dimension:nullable(cell(r,c.services.dimension)),quantity:decimal(cell(r,c.services.quantity),6),unitPrice:money(cell(r,c.services.unit)),total:money(cell(r,c.services.total)),energy:decimal(cell(r,c.services.energy),6)}
  })
  const components=p.map(r=>{
    check(r,c.components.budget)
    return {rowId:r.rowId,diagnosisRowId:find(di,cell(r,c.components.parent)).rowId,code:text(cell(r,c.components.code)),description:text(cell(r,c.components.name)),quantity:decimal(cell(r,c.components.quantity),6),unitSalePrice:money(cell(r,c.components.unit)),total:money(cell(r,c.components.total))}
  })
  const stages=e.map(r=>{
    check(r,c.stages.budget)
    // The legacy stage's service column is a label, not an ID. Its full
    // stage business key embeds the exact parent service business key.
    const key=text(cell(r,c.stages.id)),match=/^(.*)_E[0-9]+$/.exec(key)
    if(!match)return fail('chave de etapa sem serviço')
    const parent=find(si,match[1])
    if(text(cell(parent,c.services.parent))!==text(cell(r,c.stages.parent))||text(cell(parent,c.services.name))!==text(cell(r,c.stages.service)))return fail('etapa incompatível com pai')
    return {rowId:r.rowId,serviceRowId:parent.rowId,code:text(cell(r,c.stages.code)),stage:text(cell(r,c.stages.name)),energy:decimal(cell(r,c.stages.energy),6),allocatedAmount:decimal(cell(r,c.stages.amount),18),category:category(cell(r,c.stages.category))}
  })
  const totals={services:money(cell(budget,c.budget.services)),components:money(cell(budget,c.budget.parts)),discount:money(cell(budget,c.budget.discount)),total:money(cell(budget,c.budget.total))}
  // Gross/net and before-discount cross-check. Refuse representations the
  // current normalized contract cannot faithfully encode.
  const cents=(v:string)=>BigInt(v.replace('.',''))
  if(cents(totals.services)-cents(totals.discount)!==cents(money(cell(budget,c.budget.netServices)))||cents(totals.services)+cents(totals.components)!==cents(money(cell(budget,c.budget.beforeDiscount))))return fail('representação comercial não suportada')
  const installments=[[3,c.budget.p3,c.budget.t3],[6,c.budget.p6,c.budget.t6],[9,c.budget.p9,c.budget.t9],[12,c.budget.p12,c.budget.t12]].flatMap(([count,pc,tc])=>{
    const amount=cell(budget,pc as string),total=cell(budget,tc as string)
    if((amount===null||amount==='')&&(total===null||total===''))return []
    return [{count,amount:money(amount,true),total:money(total,true)}]
  })
  const day=cell(budget,c.budget.days)
  const factor=(v:unknown)=>v===null||v===''?null:typeof v==='string'?text(v):decimal(v,6)
  return preflightHistoricalBudget({schema:1,source:{docId,budgetTableId:t.budget,budgetRowId:budget.rowId,budgetNumber:number,atendimentoTableId:t.attendance,atendimentoRowId:attendance.rowId,diagnosisTableId:t.diagnoses,serviceTableId:t.services,componentTableId:t.components,stageTableId:t.stages},metadata:{createdAt:epoch(cell(budget,c.budget.date)),status:ref(cell(budget,c.budget.status)).name,deadlineDays:day===null||day===''?null:scalar(day),colorFactor:factor(cell(budget,c.budget.color)),riskFactor:factor(cell(budget,c.budget.risk)),pricingSource:nullable(cell(budget,c.budget.pricing))},totals,diagnoses,services,components,stages,installments})
}
/** Two complete captures are required; not a transactional Coda snapshot.
 * This detects changes of normalized business fields; callers must re-read
 * before confirmation. Never pass arbitrary untrusted captures as authority.
 */
export function normalizeHistoricalCodaCapture(first:unknown,second:unknown){
  const a=onePass(first),b=onePass(second)
  if(a.digest!==b.digest)throw new ServiceError(409,'HISTORICAL_CODA_CAPTURE_CHANGED','Os dados do ERP mudaram durante a conferência.')
  return b
}
