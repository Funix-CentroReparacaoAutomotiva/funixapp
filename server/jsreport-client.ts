// Backend-only configured renderer. Never log payloads, credentials or response bodies.
import{toJsreportData,type JsreportTerms}from'./jsreport-adapter.ts'
import type{BudgetVersion}from'../shared/pricing.ts'
import{ServiceError}from'./errors.ts'
export interface JsreportConnection{endpoint:string;username:string;password:string;template:string;timeoutMs?:number;maxPdfBytes?:number}
export function configuredJsreport():JsreportConnection{
 const endpoint=process.env.FUNIX_JSREPORT_ENDPOINT,username=process.env.FUNIX_JSREPORT_USERNAME,password=process.env.FUNIX_JSREPORT_PASSWORD
 if(!endpoint||!username||!password)throw new ServiceError(503,'PDF_NOT_CONFIGURED','O gerador de PDF ainda não foi configurado no servidor. Nenhuma emissão foi concluída.')
 return{endpoint,username,password,template:process.env.FUNIX_JSREPORT_TEMPLATE||'FUNIX - Orcamento'}
}
export function validatePdf(result:Buffer){if(result.length<16||!result.subarray(0,5).equals(Buffer.from('%PDF-'))||!result.subarray(-1024).includes(Buffer.from('%%EOF')))throw new ServiceError(502,'PDF_INVALID_RESPONSE','O gerador retornou um arquivo inválido ou incompleto.')}
export async function renderJsreportPdf(version:BudgetVersion,terms:JsreportTerms,connection:JsreportConnection,send:typeof fetch=fetch):Promise<Buffer>{
 const url=new URL(connection.endpoint),max=connection.maxPdfBytes??15*1024*1024,timeout=connection.timeoutMs??12000
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw new ServiceError(503,'PDF_CONFIGURATION_INVALID','jsreport exige uma URL HTTPS ou localhost de teste.')
 if(url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/api/report')||!connection.username||!connection.password||connection.template!=='FUNIX - Orcamento'||!Number.isSafeInteger(timeout)||timeout<1||timeout>60000||!Number.isSafeInteger(max)||max<16||max>15*1024*1024)throw new ServiceError(503,'PDF_CONFIGURATION_INVALID','Configuração do gerador de PDF inválida.')
 const data=version.snapshot.document?.data??toJsreportData(version,terms)
 let response:Response
 try{response=await send(url.toString(),{method:'POST',headers:{Authorization:'Basic '+Buffer.from(connection.username+':'+connection.password).toString('base64'),'Content-Type':'application/json',Accept:'application/pdf'},body:JSON.stringify({template:{name:connection.template},data}),signal:AbortSignal.timeout(timeout)})}
 catch{throw new ServiceError(503,'PDF_RENDER_UNAVAILABLE','O serviço de PDF não respondeu. A emissão não foi concluída; tente novamente.')}
 if(!response.ok){await response.body?.cancel().catch(()=>{});throw new ServiceError(502,'PDF_RENDER_FAILURE','O gerador de PDF recusou a solicitação. A emissão não foi concluída.')}
 const length=response.headers.get('content-length')
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>max)){await response.body?.cancel().catch(()=>{});throw new ServiceError(502,'PDF_TOO_LARGE','O gerador retornou um PDF maior que o permitido.')}
 if(!response.headers.get('content-type')?.toLowerCase().includes('application/pdf')){await response.body?.cancel().catch(()=>{});throw new ServiceError(502,'PDF_INVALID_RESPONSE','O gerador não retornou um PDF.')}
 if(!response.body)throw new ServiceError(502,'PDF_INCOMPLETE','Não foi possível receber o PDF completo.')
 const chunks:Buffer[]=[];let bytes=0
 const reader=response.body.getReader()
 try{for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>max){await reader.cancel();throw new ServiceError(502,'PDF_TOO_LARGE','O gerador retornou um PDF maior que o permitido.')}chunks.push(Buffer.from(next.value))}}
 catch(error){if(error instanceof ServiceError)throw error;throw new ServiceError(502,'PDF_INCOMPLETE','Não foi possível receber o PDF completo.')}
 finally{reader.releaseLock()}
 const result=Buffer.concat(chunks);validatePdf(result);return result
}
