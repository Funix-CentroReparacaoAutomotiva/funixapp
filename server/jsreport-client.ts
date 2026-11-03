// Internal server-only jsreport client. No credentials are sent to the browser or stored in snapshots.
import {toJsreportData,type JsreportTerms} from './jsreport-adapter.ts'
import type {BudgetVersion} from '../shared/pricing.ts'
import {ServiceError} from './errors.ts'

export interface JsreportConnection {endpoint:string;username:string;password:string;template:string;timeoutMs?:number;maxPdfBytes?:number}
const MAX_PDF=15*1024*1024
export async function renderJsreportPdf(version:BudgetVersion,terms:JsreportTerms,connection:JsreportConnection,send:typeof fetch=fetch):Promise<Buffer>{
 const url=new URL(connection.endpoint)
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('jsreport exige uma URL HTTPS.')
 if(url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/api/report'))throw Error('Endpoint do jsreport inválido.')
 if(!connection.username||!connection.password||!connection.template)throw Error('Autenticação e template do jsreport são obrigatórios.')
 const data=toJsreportData(version,terms)
 let response:Response
 try{
  response=await send(url.toString(),{
   method:'POST',
   headers:{
    'Authorization':'Basic '+Buffer.from(connection.username+':'+connection.password).toString('base64'),
    'Content-Type':'application/json',
    'Accept':'application/pdf'
   },
   body:JSON.stringify({template:{name:connection.template},data}),
   signal:AbortSignal.timeout(connection.timeoutMs??12000)
  })
 }catch{
  throw new ServiceError(503,'PDF_RENDER_UNAVAILABLE','O serviço de PDF não respondeu. A emissão não foi concluída; tente novamente.')
 }
 if(!response.ok)throw new ServiceError(502,'PDF_RENDER_FAILURE','O gerador de PDF recusou a solicitação. A emissão não foi concluída.')
 const max=connection.maxPdfBytes??MAX_PDF
 const len=Number(response.headers.get('content-length')??'0')
 if(!Number.isFinite(max)||max<=0||len>max)throw new ServiceError(502,'PDF_TOO_LARGE','O gerador retornou um PDF maior que o permitido.')
 if(!response.headers.get('content-type')?.toLowerCase().includes('application/pdf'))throw new ServiceError(502,'PDF_INVALID_RESPONSE','O gerador não retornou um PDF.')
 let result:Buffer
 try{result=Buffer.from(await response.arrayBuffer())}catch{throw new ServiceError(502,'PDF_INCOMPLETE','Não foi possível receber o PDF completo.')}
 if(result.length>max||result.length<8||!result.subarray(0,5).equals(Buffer.from('%PDF-')))throw new ServiceError(502,'PDF_INVALID_RESPONSE','O gerador retornou um arquivo inválido.')
 return result
}
