import {ServiceError} from './errors.ts'
import {configuredJsreport,validatePdf,type JsreportConnection} from './jsreport-client.ts'

/** Stamp all pages on download; never modify the stored original. Fail closed. */
export async function cancelledPdf(source:Buffer,connection:JsreportConnection=configuredJsreport(),send:typeof fetch=fetch):Promise<Buffer>{
 validatePdf(source)
 const url=new URL(connection.endpoint)
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))
  throw new ServiceError(503,'PDF_CONFIGURATION_INVALID','Gerador PDF inválido.')
 const max=15*1024*1024,timeout=connection.timeoutMs??12000
 if(!url.pathname.endsWith('/api/report')||url.search||url.hash||url.username||url.password||!connection.username||!connection.password||!Number.isInteger(timeout)||timeout<1||timeout>60000)
  throw new ServiceError(503,'PDF_CONFIGURATION_INVALID','Gerador PDF inválido.')
 if(source.length>max)throw new ServiceError(502,'PDF_TOO_LARGE','Documento excede o limite.')
 const watermark=`<!doctype html><html><head><meta charset="utf-8"><style>
 @page{size:A4;margin:0}html,body{margin:0;width:210mm;height:297mm}
 .watermark{position:fixed;left:13mm;top:116mm;width:184mm;text-align:center;
 transform:rotate(-32deg);transform-origin:center;font:900 55px Arial,sans-serif;
 letter-spacing:8px;color:rgba(173,33,45,.30);border:5px solid rgba(173,33,45,.30);
 padding:14px 0;box-sizing:border-box}
 </style></head><body><div class="watermark">CANCELADO</div></body></html>`
 const body=JSON.stringify({template:{
  // jsreport validates inline template identity before the static recipe loads the original PDF.
  content:'FUNIX PDF',engine:'none',
  recipe:'static-pdf',
  staticPdf:{pdfAsset:{content:source.toString('base64'),encoding:'base64'}},
  pdfOperations:[{type:'merge',mergeToFront:true,mergeWholeDocument:false,
   template:{recipe:'chrome-pdf',engine:'none',content:watermark,
    chrome:{marginTop:'0px',marginBottom:'0px',marginLeft:'0px',marginRight:'0px',printBackground:true}}}]
 }})
 let response:Response
 try{
  response=await send(url.toString(),{
   method:'POST',headers:{Authorization:'Basic '+Buffer.from(connection.username+':'+connection.password).toString('base64'),'Content-Type':'application/json',Accept:'application/pdf'},
   body,signal:AbortSignal.timeout(timeout)
  })
 }catch{throw new ServiceError(503,'CANCELLED_PDF_UNAVAILABLE','Não foi possível aplicar a marca de cancelamento ao PDF.')}
 if(!response.ok||!response.headers.get('content-type')?.toLowerCase().includes('application/pdf')){
  await response.body?.cancel().catch(()=>{})
  throw new ServiceError(502,'CANCELLED_PDF_RENDER_FAILED','Falha na geração do PDF cancelado.')
 }
 const length=response.headers.get('content-length')
 if(length&&(!new RegExp('^[0-9]+$').test(length)||Number(length)>max)){
  await response.body?.cancel().catch(()=>{})
  throw new ServiceError(502,'PDF_TOO_LARGE','Documento excede o limite.')
 }
 const chunks:Buffer[]=[];let size=0
 try{
  if(!response.body)throw new Error('Missing body')
  for await(const part of response.body){
   size+=part.length
   if(size>max)throw new Error('PDF too large')
   chunks.push(Buffer.from(part))
  }
 }catch{throw new ServiceError(502,'CANCELLED_PDF_RENDER_FAILED','Falha na geração do PDF cancelado.')}
 const result=Buffer.concat(chunks)
 validatePdf(result)
 return result
}
