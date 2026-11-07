// Opt-in prompt footprint diagnostics: fixed metadata only. Never return or log prompt content.
export interface VoicePromptFootprintMetric {
 format:'funix_voice_prompt_footprint_v1'
 requestBodyBytes:number
 inputContentBytes:number
 instructionsBytes:number
 outputSchemaBytes:number
 contextBytes:number
 catalogBytes:number
 piecesBytes:number
 recommendationsBytes:number
 piecePairsBytes:number
 revisionsBytes:number
 catalogItems:number
 catalogUsable:number
 catalogUnusable:number
 pieces:number
 recommendationSets:number
 recommendationRules:number
}
const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
const array=(value:unknown):unknown[]=>Array.isArray(value)?value:[]
const bytes=(value:unknown):number=>Buffer.byteLength(JSON.stringify(value)??'null','utf8')
export function summarizeVoicePromptFootprint(context:unknown,instructions:string,outputSchema:unknown,dictation:string,requestBody:string):VoicePromptFootprintMetric {
 const ctx=record(context),catalog=array(ctx.catalog),recommendations=array(ctx.recommendations)
 let usable=0,rules=0
 for(const item of catalog)if(record(item).usable===true)usable++
 for(const set of recommendations)rules+=array(record(set).rules).length
 return{
  format:'funix_voice_prompt_footprint_v1',
  requestBodyBytes:Buffer.byteLength(requestBody,'utf8'),
  inputContentBytes:bytes({catalogContext:context,dictation}),
  instructionsBytes:Buffer.byteLength(instructions,'utf8'),
  outputSchemaBytes:bytes(outputSchema),
  contextBytes:bytes(context),
  catalogBytes:bytes(ctx.catalog??null),
  piecesBytes:bytes(ctx.pieces??null),
  recommendationsBytes:bytes(ctx.recommendations??null),
  piecePairsBytes:bytes(ctx.piecePairs??null),
  revisionsBytes:bytes(ctx.revisions??null),
  catalogItems:catalog.length,
  catalogUsable:usable,
  catalogUnusable:catalog.length-usable,
  pieces:array(ctx.pieces).length,
  recommendationSets:recommendations.length,
  recommendationRules:rules
 }
}
