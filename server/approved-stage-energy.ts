/** Energy decisions explicitly approved by FUNIX direction, 2026-11-16 (#157, #244).
 * The Coda source remains immutable here. Decisions are keyed by exact origin
 * identities, with fixed historical operands; no generic blank->zero fallback.
 * In all replacements, effective energy is stored as approvedTotal + 0 so
 * legacy non-negative pricing/OS/PDF contracts remain valid.
 */
export interface StageEnergyEvidence {
 relationId:string
 serviceId:string
 dimensionId:string
 stageId:string
 stageDimensionId:string|null
 base:string|null
 rawDimension:string|null
 rawDimensionMissing:boolean
 originalTotal:string|null
}

interface Approved {
 relationId:string
 serviceId:string
 dimensionId:string
 stageId:string
 stageDimensionId:string|null
 base:string
 rawDimension:string|null
 originalTotal:string
 approvedTotal:string
 category:'blank-zero'|'negative-normalized'|'polish-m'
}

const rules:readonly Approved[]=[
 // Degradê: dimensional operand blank; base and total are both 5.
 ...([
  ['i-ekeOrRBJGn','i-SW0n7TLbtf'],
  ['i-Ou8mlsIazc','i-k8ZulOn21b'],
  ['i-LLkWvIS_GR','i-RQlr0QK5rR'],
  ['i-gJGB2ADks6','i-gXduy16b-V'],
 ] as const).map(([relationId,dimensionId])=>({
  relationId,serviceId:'i-SW0n7TLbtf',dimensionId,stageId:'i-SW0n7TLbtf',
  stageDimensionId:'i-jTU8EBeCLM',base:'5',rawDimension:null,originalTotal:'5',approvedTotal:'5',category:'blank-zero' as const
 })),
 // Vidraçaria: Coda has no stage-dimension relation; base=total=3.
 {relationId:'i-5C_giBUwFs',serviceId:'i-6v-u7Wk73b',dimensionId:'i-XAWXTYWQIa',
  stageId:'i-6v-u7Wk73b',stageDimensionId:null,base:'3',rawDimension:null,
  originalTotal:'3',approvedTotal:'3',category:'blank-zero'},
 // Pintura: retain the FINAL effective energy while removing unsupported negative operands.
 {relationId:'i-S_6NRwNdUK',serviceId:'i-XDTMBmueos',dimensionId:'i-6qb1FQ1krk',
  stageId:'i-XDTMBmueos',stageDimensionId:'i-SUivHVlB1n',base:'8',rawDimension:'-7',
  originalTotal:'1',approvedTotal:'1',category:'negative-normalized'},
 {relationId:'i-NXnon77Rne',serviceId:'i-XDTMBmueos',dimensionId:'i-6Nx-kpDlH8',
  stageId:'i-XDTMBmueos',stageDimensionId:'i-g8kG8I5f8m',base:'8',rawDimension:'-1',
  originalTotal:'7',approvedTotal:'7',category:'negative-normalized'},
 {relationId:'i-TBgYlc8UyX',serviceId:'i-XDTMBmueos',dimensionId:'i-6Nx-kpDlH8',
  stageId:'i-avxVYqUXNz',stageDimensionId:'i-g8kG8I5f8m',base:'3',rawDimension:'-1',
  originalTotal:'2',approvedTotal:'2',category:'negative-normalized'},
 // Polimento Veículo M: direction changes the effective total from 5 to 8.
 {relationId:'i-U2gB0INEA4',serviceId:'i-NG0WMuMSy1',dimensionId:'i-c5xaRttDXs',
  stageId:'i-7AlfEsZwkv',stageDimensionId:null,base:'2',rawDimension:null,
  originalTotal:'2',approvedTotal:'2',category:'polish-m'},
 {relationId:'i-vFq1IPDC6U',serviceId:'i-NG0WMuMSy1',dimensionId:'i-c5xaRttDXs',
  stageId:'i-ff8qEu9_LD',stageDimensionId:'i-g8kG8I5f8m',base:'2',rawDimension:'-1',
  originalTotal:'1',approvedTotal:'2',category:'polish-m'},
 {relationId:'i-5cH0Wlk0BH',serviceId:'i-NG0WMuMSy1',dimensionId:'i-c5xaRttDXs',
  stageId:'i-x906J_jYhv',stageDimensionId:'i-g8kG8I5f8m',base:'2',rawDimension:'-1',
  originalTotal:'1',approvedTotal:'2',category:'polish-m'},
 {relationId:'i-4AHDqDWW7R',serviceId:'i-NG0WMuMSy1',dimensionId:'i-c5xaRttDXs',
  stageId:'i-rRYmRgRJK2',stageDimensionId:'i-g8kG8I5f8m',base:'2',rawDimension:'-1',
  originalTotal:'1',approvedTotal:'2',category:'polish-m'},
 // Vitrificação Peça: energy 7, additional operand 0.
 {relationId:'i-Shnk4eSMZO',serviceId:'i-MC_Z0KK6Hn',dimensionId:'i-8o9Z1Z6jtk',
  stageId:'i-MC_Z0KK6Hn',stageDimensionId:'i-jTU8EBeCLM',base:'7',rawDimension:null,
  originalTotal:'7',approvedTotal:'7',category:'blank-zero'}
]

export const POLISH_M_DIMENSION='i-c5xaRttDXs'
export const POLISH_M_SERVICE='i-NG0WMuMSy1'
export const POLISH_M_RELATIONS=Object.freeze(['i-U2gB0INEA4','i-vFq1IPDC6U','i-5cH0Wlk0BH','i-4AHDqDWW7R'])

export function approvedEnergy(e:StageEnergyEvidence,formulaVerified:boolean){
 if(!formulaVerified)return null
 const approved=rules.find(r=>r.relationId===e.relationId)
 if(!approved||approved.serviceId!==e.serviceId||approved.dimensionId!==e.dimensionId||
    approved.stageId!==e.stageId||approved.stageDimensionId!==e.stageDimensionId||
    approved.base!==e.base||approved.originalTotal!==e.originalTotal||
    approved.rawDimension!==e.rawDimension||
    (approved.rawDimension===null&&!e.rawDimensionMissing))return null
 return {baseEnergy:approved.approvedTotal,dimensionEnergy:'0',category:approved.category,
  sourceTotal:approved.originalTotal,approvedTotal:approved.approvedTotal}
}
