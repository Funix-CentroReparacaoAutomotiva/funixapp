// Loopback-only browser QA entrypoint; never imported by server/index.ts.
import{openDatabase}from'../../database.ts'
import{AtendimentoRepository}from'../../atendimentos.ts'
import{createApp}from'../../app.ts'
const db=openDatabase(process.env.FUNIX_DATABASE_PATH!)
const app=createApp({atendimentos:new AtendimentoRepository(db),password:process.env.FUNIX_OPERATOR_PASSWORD,origin:process.env.FUNIX_APP_ORIGIN,voiceProvider:{
 transcribe:async(_audio,_mime,signal)=>{await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,80);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason)},{once:true})});return'Ditado sintético: manter o capô.'},
 interpret:async()=>({commands:[]})
}})
app.requestTimeout=15000;app.headersTimeout=10000
app.listen(8787,'127.0.0.1')
process.on('SIGTERM',()=>app.close(()=>{db.close();process.exit()}))
