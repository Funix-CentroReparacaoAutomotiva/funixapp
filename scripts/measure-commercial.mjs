// Local benchmark: temporary synthetic DBs, explicit new output, no .env/network.
import{mkdtempSync,rmSync,writeFileSync}from'node:fs'
import{tmpdir}from'node:os'
import{join}from'node:path'
import{Readable}from'node:stream'
import{openDatabase}from'../server/database.ts'
import{performanceCases,performanceFixture}from'../server/tests/fixtures/performance.ts'
import{createRequestHandler}from'../server/app.ts'
import{calculate}from'../server/pricing-engine.ts'
const output=process.argv[2];if(!output)throw Error('Usage: node scripts/measure-commercial.mjs NEW_RESULT.json')
const stats=a=>{a.sort((a,b)=>a-b);return{p50_ms:+a[Math.floor(a.length*.5)].toFixed(3),p95_ms:+a[Math.floor(a.length*.95)].toFixed(3)}}
const results=[],dir=mkdtempSync(join(tmpdir(),'funix-perf-'))
try{for(const spec of performanceCases){
 const db=openDatabase(join(dir,spec.name+'.sqlite'))
 try{
 const f=performanceFixture(db,spec),handler=createRequestHandler({atendimentos:f.atendimentos,password:'synthetic-local-perf',origin:'http://localhost:5173'})
 async function request(path,method='GET',data=null,cookie=''){
  let status=200,body='';const headers={}
  await handler(Object.assign(Readable.from(data?[JSON.stringify(data)]:[]),{url:path,method,headers:{origin:'http://localhost:5173','content-type':'application/json',cookie},socket:{remoteAddress:'127.0.0.1'}}),{setHeader(k,v){headers[k.toLowerCase()]=v},writeHead(s){status=s},end(b){body=b}})
  if(status>=400)throw Error(body);return{body,headers}
 }
 const login=await request('/api/session','POST',{password:'synthetic-local-perf'}),cookie=login.headers['set-cookie'].split(';')[0],path='/api/atendimentos/'+f.at.id+'/cenarios'
 const items=f.commercial.list(f.at.id),catalog=f.commercial.catalogs().items,scene=f.scenarios.list(f.at.id)[0],cfg=f.pricing.get().config,state=f.pricing.settings(f.at.id).settings,parts=f.components.list(f.at.id)
 const cpu=[],get=[],patch=[];let response
 for(let n=0;n<60;n++){
  let t=performance.now();calculate(items,parts,catalog,scene,cfg,state);if(n>=10)cpu.push(performance.now()-t)
  t=performance.now();response=await request(path,'GET',null,cookie);if(n>=10)get.push(performance.now()-t)
  const s=f.scenarios.list(f.at.id)[0];t=performance.now();await request(path+'/'+s.id,'PATCH',{revision:s.revision,pieceFlags:{[items[0].id]:n%2===0}},cookie);if(n>=10)patch.push(performance.now()-t)
 }
 const prepare=db.prepare.bind(db);let prepares=0,selects=0
 db.prepare=sql=>{prepares++;const stmt=prepare(sql);return new Proxy(stmt,{get(target,key){const value=Reflect.get(target,key);return typeof value==='function'?function(...args){if(['all','get','iterate'].includes(key)&&/^\s*(SELECT|WITH)\b/i.test(sql))selects++;return value.apply(target,args)}:value}})}
 await request(path,'GET',null,cookie);db.prepare=prepare
 results.push({...spec,samples:50,pure_calculation:stats(cpu),full_workspace:stats(get),flag_patch:stats(patch),workspace_bytes:Buffer.byteLength(response.body),prepare_calls:prepares,select_executions:selects})
 }finally{db.close()}
}}finally{rmSync(dir,{recursive:true,force:true})}
writeFileSync(output,JSON.stringify({node:process.version,storage:'temporary file, SQLite synchronous FULL',results},null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(results))
