import {normalizeCiliaPieceTitle,suggestCiliaPiece} from './cilia-piece-rules.ts'

export const CILIA_SERVICE_RULE_VERSION='cilia-service-candidates-v1'
const prefix='coda:2zsjI-nqWr:grid-lhdFxol6x-:'
const ids={montagem:prefix+'i-vmJ3Org23i',funilaria:prefix+'i-q8IL0mnuIJ',pintura:prefix+'i-XDTMBmueos',degrade:prefix+'i-SW0n7TLbtf',reparo:prefix+'i-5zkNjBv-Zg',eletrica:prefix+'i-6FW6UIOr8H',mecanica:prefix+'i-RoaRcVLUCo',vidracaria:prefix+'i-6v-u7Wk73b',tapecaria:prefix+'i-kNfje5jSDQ'} as const
export type CiliaServiceSource={id:string;name:string;typeKind:string;scope:string;removalKind:string|null;netPrice:string;supplyKind:string;rawFlags:{troca:boolean};operations:readonly {kind:'T'|'RI'|'R'|'P';hours:string|null;rate:string|null;amount:string|null}[]}
type Catalog=Parameters<typeof suggestCiliaPiece>[1]
type Steering=Parameters<typeof suggestCiliaPiece>[2]
const structural=/\b(LONGARINA|TRAVESSA|PAINEL|COLUNA|ASSOALHO|CAIXA DE RODA|CORTE|SOLDA)\b/
const plastic=/\b(PARACHOQUE|PARABARRO|SPOILER|MOLDURA|FRISO|GRADE|FAROL|LANTERNA)\b/
const blend=new Set(['ABERTURA DE TINTA NA PORTA TRASEIRA ESQUERDA','ABERTURA DE TINTA NO PARA-LAMA DIANTEIRO ESQUERDO'].map(normalizeCiliaPieceTitle))
const norm=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toUpperCase().trim()

/** Proposals only. Never deduplicate operations by native piece, price, or
 * service. Never choose a dimension, quantity, diagnosis or grouping. */
export function suggestCiliaServices<T extends CiliaServiceSource>(row:T,catalog:Catalog,steering:Steering='unknown'){
 const piece=suggestCiliaPiece(row.name,catalog,steering)
 const title=normalizeCiliaPieceTitle(row.name),category=norm(row.removalKind??'')
 const baseIssues=[...piece.issues]
 if(norm(row.scope)!=='IMPACTO')baseIssues.push('SCOPE_REVIEW')
 if(row.typeKind!=='part'&&row.typeKind!=='service')baseIssues.push('ITEM_TYPE_REVIEW')
 if(row.supplyKind==='unknown')baseIssues.push('SUPPLY_REVIEW')
 if(structural.test(title))baseIssues.push('STRUCTURAL_METHOD_REVIEW')
 const resolve=(key:keyof typeof ids,issues:string[])=>{
  const matches=catalog.filter(c=>c.id===ids[key]&&c.kind==='servico')
  if(matches.length!==1||!matches[0]!.active||!matches[0]!.name.trim()){issues.push('SERVICE_CATALOG_UNAVAILABLE:'+key);return []}
  return [{serviceId:ids[key]}]
 }
 const propose=(sourceId:string,kind:'T'|'RI'|'R'|'P'|'manual',hours:string|null,rate:string|null,amount:string|null,keys:(keyof typeof ids)[],extra:string[])=>{
  const issues=[...baseIssues,...extra]
  if(amount===null)issues.push('AMOUNT_UNKNOWN')
  if(kind!=='manual'&&hours!==null&&/^0+(?:\.0+)?$/.test(hours))issues.push('ZERO_TIME_SCOPE_REVIEW')
  const candidates=keys.flatMap(key=>resolve(key,issues))
  return {sourceId,kind,hours,rate,amount,candidates,issues:[...new Set(issues)],state:issues.length||candidates.length!==1?'review' as const:'candidate' as const,requiresOperatorReview:true as const}
 }
 const operations=row.operations.map((op,index)=>{
  let keys:(keyof typeof ids)[]=[],extra:string[]=[]
  if(row.typeKind!=='part')extra.push('MANUAL_OPERATION_REVIEW')
  if(op.kind==='T'||op.kind==='RI'){
   if(category==='ELETRICA'){keys=['eletrica'];extra.push('SPECIALTY_METHOD_REVIEW')}
   else if(category==='MECANICA'){keys=['mecanica'];extra.push('SPECIALTY_METHOD_REVIEW')}
   else if(category==='VIDRACARIA'){keys=['vidracaria'];extra.push('SPECIALTY_METHOD_REVIEW')}
   else if(category==='TAPECARIA'){keys=['montagem','tapecaria'];extra.push('SPECIALTY_METHOD_REVIEW')}
   else if(category==='FUNILARIA')keys=['montagem']
   else extra.push('REMOVAL_METHOD_REVIEW')
  }else if(op.kind==='R'){
   keys=plastic.test(title)?['funilaria','reparo']:['funilaria']
   if(keys.length>1)extra.push('REPAIR_METHOD_REVIEW')
  }else if(op.kind==='P'){
   keys=blend.has(title)?['degrade']:['pintura']
   if(/\b(MICROPINTURA|POLIMENTO|PRIMER)\b/.test(title))extra.push('PAINT_SCOPE_REVIEW')
  }
  return propose(row.id+':op-'+(index+1),op.kind,op.hours,op.rate,op.amount,keys,extra)
 })
 if(row.typeKind==='service'){
  const keys:(keyof typeof ids)[]=title==='REM E INST CONJUNTO MOTRIZ'?['mecanica']:title==='LIMPEZA DOS CODIGOS DE FALHA'?['eletrica']:[]
  operations.push(propose(row.id+':manual','manual',null,null,row.netPrice,keys,['MANUAL_SERVICE_REVIEW']))
 }
 // Preserve source / supplier evidence; RI is not a purchase. No accounting
 // conversion is done here. Even proposals without issues require review.
 return {version:CILIA_SERVICE_RULE_VERSION,source:row,piece,operations,componentReview:row.typeKind==='part'&&row.rawFlags.troca,requiresOperatorReview:true as const,canWrite:false as const}
}
