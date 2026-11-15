// Explicit synthetic demo. Never loads .env, real providers or the normal application database.
import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'
import {existsSync,mkdirSync} from 'node:fs'
import {openDatabase} from '../server/database.ts'
import {AtendimentoRepository} from '../server/atendimentos.ts'
import {createGmailIntakeSchema} from '../server/gmail-intake-schema.ts'
import {createUpdatePackageSchema} from '../server/update-packages-schema.ts'
import {createGmailAnalysisSchema} from '../server/gmail-analysis-schema.ts'
import {GmailIntakeRepository} from '../server/gmail-intake.ts'
import {GmailAnalysisService} from '../server/gmail-analysis.ts'
import {syntheticAnalysisProviders} from '../server/gmail-analysis-providers.ts'
import {analysisFixture,analysisNotice} from '../server/tests/fixtures/gmail-analysis.ts'
import {createApp} from '../server/app.ts'
export function analysisDemo(path=':memory:'){
 const db=openDatabase(path);createGmailIntakeSchema(db);createUpdatePackageSchema(db);createGmailAnalysisSchema(db)
 const fixture=analysisFixture(),providers=syntheticAnalysisProviders(fixture),notices=new GmailIntakeRepository(db)
 const notice=notices.ingest(analysisNotice()),service=new GmailAnalysisService(db,providers)
 return {db,fixture,providers,notices,notice,service,atendimentos:new AtendimentoRepository(db)}
}
export function analysisDemoFlags(){Object.assign(process.env,{
 FUNIX_UPDATES_STORAGE_ENABLED:'true',FUNIX_UPDATES_DECISIONS_ENABLED:'true',FUNIX_UPDATES_CLARIFICATIONS_ENABLED:'true',
 FUNIX_GMAIL_INTAKE_STORAGE_ENABLED:'true',FUNIX_GMAIL_INTAKE_DECISIONS_ENABLED:'true'
})}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const path=resolve('.runtime/gmail-mvp01-demo/demo.sqlite')
 if(!existsSync(resolve('.runtime/gmail-mvp01-demo')))mkdirSync(resolve('.runtime/gmail-mvp01-demo'),{recursive:true})
 analysisDemoFlags();const demo=analysisDemo(path)
 const app=createApp({atendimentos:demo.atendimentos,gmailAnalysis:demo.service,origin:'http://127.0.0.1:5173',password:'synthetic-mvp01-password-0123',voiceProvider:null})
 demo.service.start();app.listen(8787,'127.0.0.1',()=>console.log('Demo sintética: http://127.0.0.1:5173/atualizacoes · senha synthetic-mvp01-password-0123'))
 const stop=async()=>{await demo.service.stop();app.close(()=>{demo.db.close()})}
 process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop())
}
