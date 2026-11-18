import type {WorkOrder} from '../shared/work-order.ts'
import {ServiceError} from './errors.ts'
import {validatePdf} from './jsreport-client.ts'
import {renderOrderV1} from './os-template.ts'

/** Does not reuse the commercial template; jsreport is the renderer, not the OS source of truth. */
export function configuredOrderRenderer(){
 const endpoint=process.env.FUNIX_JSREPORT_ENDPOINT
 const username=process.env.FUNIX_JSREPORT_USERNAME
 const password=process.env.FUNIX_JSREPORT_PASSWORD
 if(!endpoint||!username||!password)
   throw new ServiceError(503,'OS_PDF_NOT_CONFIGURED','O gerador da OS não está configurado.')
 return {endpoint,username,password}
}

export async function renderOrderJsreport(order:WorkOrder,connection:ReturnType<typeof configuredOrderRenderer>,send:typeof fetch=fetch):Promise<Buffer>{
 let url:URL
 try{url=new URL(connection.endpoint)}catch{throw new ServiceError(503,'OS_PDF_CONFIGURATION_INVALID','Endereço do renderizador inválido.')}
 if((url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))||
    !url.pathname.endsWith('/api/report')||url.username||url.password||url.search||url.hash||
    !connection.username||!connection.password)
   throw new ServiceError(503,'OS_PDF_CONFIGURATION_INVALID','Configuração do renderizador inválida.')
 const print=renderOrderV1(order)
 const timeoutMs=20000,maxBytes=15*1024*1024
 const request={
   template:{
     content:print.content,engine:'none',recipe:'chrome-pdf',
     chrome:{
       format:'A4',landscape:true,printBackground:true,displayHeaderFooter:true,
       headerTemplate:print.headerTemplate,footerTemplate:print.footerTemplate,
       marginTop:'23mm',marginRight:'5mm',marginBottom:'15mm',marginLeft:'5mm'
     }
   },
   data:{}
 }
 let response:Response
 try {
   response=await send(url.toString(),{
     method:'POST',
     headers:{
       Authorization:'Basic '+Buffer.from(connection.username+':'+connection.password).toString('base64'),
       'Content-Type':'application/json',Accept:'application/pdf'
     },
     body:JSON.stringify(request),signal:AbortSignal.timeout(timeoutMs)
   })
 } catch {
   throw new ServiceError(503,'OS_PDF_RENDER_UNAVAILABLE','O gerador da OS não respondeu.')
 }
 if(!response.ok){
   await response.body?.cancel().catch(()=>{})
   throw new ServiceError(502,'OS_PDF_RENDER_FAILURE','Não foi possível renderizar a OS.')
 }
 if(!response.headers.get('content-type')?.toLowerCase().includes('application/pdf')){
   await response.body?.cancel().catch(()=>{})
   throw new ServiceError(502,'OS_PDF_INVALID','O gerador retornou um arquivo inesperado.')
 }
 const length=response.headers.get('content-length')
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxBytes)){
   await response.body?.cancel().catch(()=>{})
   throw new ServiceError(502,'OS_PDF_TOO_LARGE','O PDF da OS excede o tamanho permitido.')
 }
 if(!response.body)throw new ServiceError(502,'OS_PDF_INVALID','O PDF da OS não foi recebido.')
 const chunks:Buffer[]=[]
 let bytes=0
 const reader=response.body.getReader()
 try{
   for(;;){
     const next=await reader.read()
     if(next.done)break
     bytes+=next.value.byteLength
     if(bytes>maxBytes){
       await reader.cancel()
       throw new ServiceError(502,'OS_PDF_TOO_LARGE','O PDF da OS excede o tamanho permitido.')
     }
     chunks.push(Buffer.from(next.value))
   }
 }catch(error){
   if(error instanceof ServiceError)throw error
   throw new ServiceError(502,'OS_PDF_INVALID','A transferência do PDF foi interrompida.')
 }finally{reader.releaseLock()}
 const pdf=Buffer.concat(chunks)
 validatePdf(pdf)
 return pdf
}
