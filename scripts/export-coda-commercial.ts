// Run on an authorized workstation only. GET-only allowlist; never fetches customer rows.
import {writeFileSync,readFileSync} from 'node:fs'
import {DOCUMENT,TABLES,parseCodaJson} from '../server/coda-import-source.ts'
import {normalizeConnectorCapture} from '../server/coda-connector-export.ts'

if(process.argv[2]==='--connector-capture'){
 if(process.argv.length!==5)throw new Error('Uso: node scripts/export-coda-commercial.ts --connector-capture CAPTURA_PRIVADA.json SAIDA_NOVA.json')
 const bundle=normalizeConnectorCapture(parseCodaJson(readFileSync(process.argv[3]!,'utf8')))
 writeFileSync(process.argv[4]!,JSON.stringify(bundle,null,2),{flag:'wx',mode:0o600})
 console.log('Captura real do conector normalizada; fórmulas e referências preservadas.')
}else{

const output=process.argv[2],token=process.env.CODA_API_TOKEN
if(!output || process.argv.length!==3 || !token)throw new Error('Use CODA_API_TOKEN no ambiente e node --use-env-proxy scripts/export-coda-commercial.ts /caminho/privado/export.json')
const root=`https://coda.io/apis/v1/docs/${DOCUMENT}/tables/`
async function get(path:string){
 const response=await fetch(root+path,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000),redirect:'error'})
 if(!response.ok)throw new Error(`Leitura Coda falhou: HTTP ${response.status}; nenhum conteúdo remoto/credencial exibido.`)
 return parseCodaJson(await response.text()) as Record<string,unknown>
}
async function list(path:string,query:Record<string,string>={}){
 const items:Record<string,unknown>[]=[];let pageToken:string|undefined
 do{
  const params=new URLSearchParams({...query,limit:'100',...(pageToken?{pageToken}:{})})
  const response=await get(path+'?'+params)
  if(!Array.isArray(response.items))throw new Error('Resposta Coda incompleta.')
  items.push(...response.items)
  pageToken=typeof response.nextPageToken==='string'?response.nextPageToken:undefined
 }while(pageToken)
 return items
}
async function schema(id:string){
 const columns=await list(id+'/columns')
 return columns.map(c=>({columnId:c.id,name:c.name,formula:c.formula??null}))
}
const tables=[]
for(const id of Object.values(TABLES)){
 const before=await get(id)
 const columns=await schema(id)
 // Only configuration tables are allowlisted; operational tables are never read.
 const rows=await list(id+'/rows',{valueFormat:'rich',useColumnNames:'false'})
 const after=await get(id)
 if(!Number.isSafeInteger(before.rowCount) || before.rowCount!==rows.length || after.rowCount!==before.rowCount)throw new Error('Contagem Coda ausente/divergente ou tabela alterada durante exportação; repita sem editar os cadastros.')
 tables.push({id,schema:{columns,rowCount:before.rowCount},totalRows:rows.length,hasMore:false,rows:rows.map(r=>({rowId:r.id,values:r.values}))})
}
const pricingFormulaSchema={columns:await schema('grid-aHz1ZDVlfK')}
writeFileSync(output,JSON.stringify({format:'funix-coda-commercial-v1',documentId:DOCUMENT,exportedAt:new Date().toISOString(),tables,pricingFormulaSchema},null,2),{flag:'wx',mode:0o600})
console.log('Exportação comercial concluída. Arquivo privado; não adicionar ao Git.')
}
