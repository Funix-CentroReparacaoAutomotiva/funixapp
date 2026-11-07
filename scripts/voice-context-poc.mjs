// FUNIX Issue #77: isolated and bounded A/B experiment; no Atendimento writes.
// To authorize the six paid Responses API calls, set FUNIX_VOICE_POC_RUN=1 for this process.
// Designed to be piped to node --input-type=module inside the existing API container.
import {DatabaseSync} from 'node:sqlite';
import {lstatSync} from 'node:fs';

const ready=process.env.FUNIX_VOICE_POC_RUN==='1';
if(!ready){
 console.log(JSON.stringify({status:'DRY_RUN',message:'No API call made. Set FUNIX_VOICE_POC_RUN=1 explicitly.'}));
 process.exit(0);
}
const rates={asOf:'2026-11-07',model:'gpt-6.1-terra',uncachedInputPerMillion:1,cachedInputPerMillion:0.05,outputPerMillion:5};
const cases=[
 {id:'piece',text:'Inclua o capô.'},
 {id:'ambiguous_piece',text:'Acrescente uma porta.'},
 {id:'explicit_service',text:'No capô, acrescente pintura parcial.'}
];
const maxCalls=cases.length*2;
const databasePath=process.env.FUNIX_DATABASE_PATH||'/data/funix.sqlite';
if(databasePath!=='/data/funix.sqlite')throw Error('POC_DB_PATH_REJECTED');
if(!process.env.OPENAI_API_KEY)throw Error('POC_API_KEY_NOT_CONFIGURED');
if(lstatSync(databasePath).isSymbolicLink())throw Error('POC_DB_SYMLINK_REJECTED');

const {CommercialRepository}=await import('/app/server/commercial.ts');
const {modelVoiceContext}=await import('/app/server/voice-context.ts');
const {recommendations}=await import('/app/server/diagnosis-recommendations.ts');
const {DIAGNOSIS_INTENSITIES,catalogItemUsable}=await import('/app/shared/commercial.ts');
const {openAIVoiceProvider}=await import('/app/server/voice-provider.ts');
const {convertVoiceModelOutput}=await import('/app/server/voice-model-contract.ts');

const db=new DatabaseSync(databasePath,{readOnly:true});
let catalog,sets;
try{
 catalog=new CommercialRepository(db).catalogs().items;
 sets=catalog.filter(item=>item.kind==='diagnostico').flatMap(item=>DIAGNOSIS_INTENSITIES.map(intensity=>({
  diagnosisId:item.id,intensity,availability:'available',rules:recommendations(db,item.id,intensity),
  pending:db.prepare("SELECT id AS ruleId,reason FROM diagnosis_recommendations WHERE diagnosis_id=? AND intensity=? AND status='pending' ORDER BY id").all(item.id,intensity).map(row=>({ruleId:String(row.ruleId),reason:String(row.reason)}))
 })));
}finally{db.close();}
if(catalog.length<100||sets.length<1||!sets.some(set=>set.rules.length>0))throw Error('POC_CATALOG_NOT_REPRESENTATIVE');
// This synthetic scenario never opens a real customer or Atendimento.
const qaId='qa-synthetic-no-database-row';
const planning={
 atendimentoId:qaId,catalog,recommendations:sets,
 workspace:{
  selectedId:qaId,revision:1,configurationRevision:1,
  scenarios:[{id:qaId,atendimentoId:qaId,name:'QA',position:1,revision:1,pieceFlags:{},serviceFlags:{},componentFlags:{}}],
  items:[],components:[]
 }
};
const standard=modelVoiceContext(planning);
const reduced={...standard};
delete reduced.recommendations;
const bytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
const normal=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const cape=catalog.find(item=>item.kind==='peca'&&item.code==='capo'&&catalogItemUsable(item));
if(!cape)throw Error('POC_CAPO_MISSING');
const catalogById=new Map(catalog.map(item=>[item.id,item]));
const inspect=(caseId,raw)=>{
 const cmds=convertVoiceModelOutput(raw);
 const relevant=cmds.filter(cmd=>cmd&&typeof cmd==='object');
 const refs=cmd=>cmd.piece;
 let ok=false;
 if(caseId==='piece')ok=relevant.some(cmd=>cmd.op==='add_piece'&&refs(cmd)?.state==='resolved'&&refs(cmd).id===cape.id);
 if(caseId==='ambiguous_piece')ok=relevant.some(cmd=>cmd.op==='add_piece'&&refs(cmd)?.state==='unresolved')&&
  !relevant.some(cmd=>refs(cmd)?.state==='resolved'&&catalogById.get(refs(cmd).id)?.kind==='peca');
 if(caseId==='explicit_service')ok=relevant.some(cmd=>{
  if(cmd.op!=='add_service'||refs(cmd)?.state!=='resolved'||refs(cmd).id!==cape.id||cmd.service?.state!=='resolved'||cmd.dimension?.state!=='resolved')return false;
  const dimension=catalogById.get(cmd.dimension.id),service=catalogById.get(cmd.service.id);
  return dimension?.kind==='dimensao'&&service?.kind==='servico'&&dimension.serviceId===service.id&&normal(dimension.name).includes('parcial');
 });
 // Command identifiers are generated freely; exclude them from comparison.
 const signature=JSON.stringify(relevant.map(cmd=>{
  const normalized={...cmd};delete normalized.id;
  if(normalized.piece?.state==='unresolved')normalized.piece={...normalized.piece,candidates:[...(normalized.piece.candidates??[])].sort()};
  return normalized;
 }).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
 return{ok,signature,commandCount:relevant.length,pendingPieces:relevant.filter(cmd=>cmd.piece?.state==='unresolved').length};
};
const estimatedUsd=metric=>{
 if(!metric||metric.inputTokens===null||metric.cachedInputTokens===null||metric.outputTokens===null||metric.cachedInputTokens>metric.inputTokens)return null;
 // Standard public token rates, excluding special tiers, possible cache-write rates and reconciliations.
 return(Number(((metric.inputTokens-metric.cachedInputTokens)*rates.uncachedInputPerMillion+
   metric.cachedInputTokens*rates.cachedInputPerMillion+metric.outputTokens*rates.outputPerMillion)/1e6).toFixed(8));
};
const environment={...process.env,FUNIX_VOICE_USAGE_ENABLED:'true',FUNIX_VOICE_FOOTPRINT_ENABLED:'false',FUNIX_VOICE_REASONING_EFFORT:''};
let currentMetric=null;
const provider=openAIVoiceProvider(environment,fetch,metric=>{currentMetric=metric});
if(!provider)throw Error('POC_PROVIDER_UNAVAILABLE');
const rows=[],rawByCase=new Map();
console.log(JSON.stringify({
 status:'START',safety:'read_only_catalog_synthetic_scenario_no_audio_no_write',
 callsMaximum:maxCalls,model:environment.FUNIX_VOICE_INTERPRETATION_MODEL||'gpt-6.1-terra',
 contextBytes:{standard:bytes(standard),reduced:bytes(reduced),recommendations:bytes(standard.recommendations)},
 catalogItems:catalog.length,recommendationRules:sets.reduce((sum,set)=>sum+set.rules.length,0),
 estimateRates:rates,note:'USD values below are tariff estimates, not per-call billed amounts.'
}));
for(let i=0;i<cases.length;i++){
 const c=cases[i],modes=i%2===0?['standard','reduced']:['reduced','standard'];
 for(const mode of modes){
  currentMetric=null;
  let result;
  const start=performance.now();
  try{
   result=await provider.interpret(c.text,mode==='standard'?standard:reduced,AbortSignal.timeout(45000));
   const semantics=inspect(c.id,result);
   const metric=currentMetric;
   const row={case:c.id,mode,ok:semantics.ok,commands:semantics.commandCount,pendingPieces:semantics.pendingPieces,
    inputTokens:metric?.inputTokens??null,cachedInputTokens:metric?.cachedInputTokens??null,
    outputTokens:metric?.outputTokens??null,reasoningOutputTokens:metric?.reasoningOutputTokens??null,
    elapsedMs:metric?.elapsedMs??Math.round(performance.now()-start),
    estimatedUsd:estimatedUsd(metric),status:'response'};
   rows.push(row);rawByCase.set(c.id+':'+mode,semantics.signature);
   console.log(JSON.stringify({type:'CALL',...row}));
  }catch(error){
   const code=typeof error?.code==='string'&&/^[A-Z0-9_]{1,90}$/.test(error.code)?error.code:'POC_MODEL_OR_VALIDATION_FAILED';
   const row={case:c.id,mode,status:'error',code,inputTokens:currentMetric?.inputTokens??null,estimatedUsd:estimatedUsd(currentMetric)};
   rows.push(row);console.log(JSON.stringify({type:'CALL',...row}));
   console.log(JSON.stringify({type:'STOP',reason:'Provider failure or invalid output; never apply any changes.'}));
   process.exit(2);
  }
 }
}
const byMode=mode=>{
 const list=rows.filter(row=>row.mode===mode&&row.status==='response');
 const sum=key=>list.some(row=>row[key]===null)?null:list.reduce((t,row)=>t+row[key],0);
 return{calls:list.length,semanticPass:list.filter(row=>row.ok).length,
  inputTokens:sum('inputTokens'),cachedInputTokens:sum('cachedInputTokens'),
  outputTokens:sum('outputTokens'),estimatedUsd:sum('estimatedUsd')};
};
const comparisons=cases.map(c=>({case:c.id,sameCommandSignature:rawByCase.get(c.id+':standard')===rawByCase.get(c.id+':reduced'),
  bothSemanticPass:rows.filter(row=>row.case===c.id).every(row=>row.ok)}));
console.log(JSON.stringify({type:'SUMMARY',standard:byMode('standard'),reduced:byMode('reduced'),comparisons,
 recommendation:'Use only after reviewing semantics and a real billing reconciliation; no application was written.'}));
