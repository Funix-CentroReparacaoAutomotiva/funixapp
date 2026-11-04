import type {CatalogItem,CommercialWorkspace,DiagnosisIntensity,DiagnosisItem,DiagnosisRecommendation,DiagnosisService} from './commercial.ts'

export const VOICE_COMMANDS_FORMAT='funix-voice-commands-v1' as const
// The interpreter identifies references; the planner never resolves names or candidates.
export type VoiceReference={state:'resolved';id:string}|{state:'unresolved';text:string;candidates?:string[]}
export type VoiceLineReference={kind:'id';id:string}|{kind:'service';service:VoiceReference}|{kind:'command';commandId:string}
type CommandBase={id:string;intent:'instruction'|'correction';piece:VoiceReference;sourceText?:string}
export type VoiceCommand=CommandBase&(
 |{op:'add_piece'}
 |{op:'remove_piece'}
 |{op:'set_piece_enabled';enabled:boolean}
 |{op:'set_diagnosis';diagnosis?:VoiceReference|null;intensity?:DiagnosisIntensity|null;additionalDamage?:boolean}
 |({op:'add_service';service:VoiceReference;quantity?:string}&({intent:'instruction';dimension:VoiceReference|null}|{intent:'correction';dimension?:VoiceReference|null}))
 |{op:'set_dimension';line:VoiceLineReference;dimension:VoiceReference|null}
 |{op:'set_quantity';line:VoiceLineReference;mode:'increment'|'absolute';value:string}
 |{op:'set_service_enabled';line:VoiceLineReference;enabled:boolean}
 |{op:'remove_service';line:VoiceLineReference}
 |{op:'set_notes';line?:VoiceLineReference;value:string}
 |{op:'recommend_services';mode:'automatic'|'assisted';ruleIds?:string[]}
)
export interface VoiceRevisions{
 composition:number;configuration:number
 scenarios:{id:string;revision:number}[];pieces:{id:string;revision:number}[]
}
export interface VoiceCommandBatch{
 format:typeof VOICE_COMMANDS_FORMAT;idempotencyKey:string;atendimentoId:string;scenarioId:string
 expected:VoiceRevisions;commands:VoiceCommand[]
}
// Query result must be loaded by the backend, not supplied by the future AI.
export interface VoiceRecommendationSet{
 diagnosisId:string;intensity:DiagnosisIntensity|null;availability:'available'|'unavailable'
 rules:DiagnosisRecommendation[];pending?:{ruleId:string;reason:string}[]
}
export interface VoiceReceipt{atendimentoId:string;scenarioId:string;idempotencyKey:string;requestDigest:string;handledCommandIds:string[]}
export interface VoicePlanningContext{
 atendimentoId:string;workspace:Pick<CommercialWorkspace,'selectedId'|'revision'|'configurationRevision'|'items'|'scenarios'> & {components:Pick<CommercialWorkspace['components'][number],'id'|'pieceId'>[];calculations?:Pick<CommercialWorkspace['calculations'][number],'scenarioId'|'errors'>[]}
 catalog:CatalogItem[];recommendations:VoiceRecommendationSet[];receipts?:VoiceReceipt[]
}
export type VoiceOrigin={kind:'explicit';commandId:string;intent:'instruction'|'correction'}|{kind:'rule';commandId:string;ruleId:string}|{kind:'existing-default';commandId:string;rule:'initial-quantity-one'|'new-item-flags'}
export interface VoiceIssue{commandId?:string;code:string;message:string;blocking:boolean;references?:string[]}
export interface VoiceResult{index:number;commandId:string;status:'valid'|'noop'|'pending'|'conflict';reason?:string}
export type VoiceEntityReference={kind:'existing'|'planned';id:string}
type PieceValues=Pick<DiagnosisItem,'diagnosisId'|'notes'>&{intensity:DiagnosisIntensity|null}
type ServiceValues=Pick<DiagnosisService,'serviceId'|'dimensionId'|'quantity'>&{notes:string;diagnosisId:string|null;recommendationRuleId?:string|null}
type ChangeBase={origins:Partial<Record<'presence'|'pieceId'|'diagnosisId'|'intensity'|'notes'|'serviceId'|'dimensionId'|'quantity'|'enabled',VoiceOrigin>>;impact:{scope:'shared'|'active-scenario';scenarioIds:string[];invalidatesExecutionConfirmations:boolean;requiresGlobalRemovalConfirmation:boolean}}
export type VoiceChange=ChangeBase&(
 |{op:'add_piece';target:VoiceEntityReference;pieceId:string;values:PieceValues;flags:Record<string,boolean>}
 |{op:'update_piece';target:VoiceEntityReference;before:Partial<PieceValues>;patch:Partial<PieceValues>}
 |{op:'remove_piece';target:VoiceEntityReference}
 |{op:'add_service';target:VoiceEntityReference;piece:VoiceEntityReference;values:ServiceValues;flags:Record<string,boolean>}
 |{op:'update_service';target:VoiceEntityReference;piece:VoiceEntityReference;before:Partial<ServiceValues>;patch:Partial<ServiceValues>}
 |{op:'remove_service';target:VoiceEntityReference;piece:VoiceEntityReference}
 |{op:'set_piece_enabled'|'set_service_enabled';target:VoiceEntityReference;scenarioId:string;before:boolean;enabled:boolean}
)
export interface VoicePlan{
 format:'funix-voice-plan-v1';idempotencyKey:string|null;requestDigest:string;stateDigest:string
 guards:VoiceRevisions;results:VoiceResult[];changes:VoiceChange[];issues:VoiceIssue[]
 usedRules:{id:string;commandId:string;serviceId:string;dimensionId:string}[]
 replay:boolean;requiresCalculation:boolean
}
