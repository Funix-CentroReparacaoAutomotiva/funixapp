// Local browser-test server only. Reads the synthetic reservation, never production.
import{createServer}from'node:http'
import{DatabaseSync}from'node:sqlite'
import{existsSync}from'node:fs'
import{budgetPdf}from'../../pdf.ts'
import type{BudgetVersion}from'../../../shared/pricing.ts'
const path=process.env.FUNIX_DATABASE_PATH!,password=process.env.FUNIX_JSREPORT_PASSWORD!
let mode='normal',delay=0,calls=0
const server=createServer(async(req,res)=>{
 if(req.method==='GET'&&req.url==='/health'){res.end('ok');return}
 if(req.url==='/__test/stats'&&req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({calls}));return}
 if(req.url==='/__test/control'&&req.method==='POST'&&req.headers.authorization==='Basic '+Buffer.from('synthetic:'+password).toString('base64')){const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const d=JSON.parse(Buffer.concat(chunks).toString());mode=String(d.mode);delay=Number.isInteger(d.delayMs)&&d.delayMs>=0&&d.delayMs<=5000?d.delayMs:0;res.end('{}');return}
 if(req.url!=='/api/report'||req.method!=='POST'||req.headers.authorization!=='Basic '+Buffer.from('synthetic:'+password).toString('base64')){res.writeHead(401);res.end();return}
 try{
  calls++;if(delay)await new Promise(resolve=>setTimeout(resolve,delay));if(mode==='fail'){res.writeHead(500);res.end('synthetic failure');return}if(mode==='truncate'){res.writeHead(200,{'Content-Type':'application/pdf'});res.end('%PDF-1.7\n');return}
  let bytes=0;const chunks:Buffer[]=[]
  for await(const chunk of req){bytes+=chunk.length;if(bytes>4*1024*1024)throw Error('large');chunks.push(Buffer.from(chunk))}
  const request=JSON.parse(Buffer.concat(chunks).toString()),match=/^OR-(\d+)$/.exec(request.data.meta.id)
  if(request.template.name!=='FUNIX - Orcamento'||!match||!existsSync(path))throw Error('invalid')
  const db=new DatabaseSync(path,{readOnly:true})
  let version:BudgetVersion
  try{const row=db.prepare('SELECT * FROM budget_emission_attempts WHERE serial=?').get(Number(match[1]))!;version={id:String(row.version_id),atendimentoId:String(row.atendimento_id),sequence:0,label:'',createdAt:String(row.created_at),documentNumber:request.data.meta.id,snapshot:JSON.parse(String(row.snapshot))};if(JSON.stringify(request.data)!==JSON.stringify(version.snapshot.document?.data))throw Error('not frozen')}
  finally{db.close()}
  const pdf=budgetPdf(version);res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':pdf.length});res.end(pdf)
 }catch{res.writeHead(500);res.end('synthetic render failed')}
})
server.listen(8788,'127.0.0.1')
for(const signal of['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit()))
