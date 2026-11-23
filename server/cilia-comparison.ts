import {assembleCiliaReviewedScope} from './cilia-review.ts'
import type {CiliaScopeReview} from './cilia-review.ts'
import {planExternalBudget} from './external-budget-plan.ts'
import {servicePolicy} from '../shared/commercial-curation.ts'
import type {CatalogItem} from '../shared/commercial.ts'
import type {PricingConfiguration,PricingSettings} from '../shared/pricing.ts'

/** Read-only comparison: reconstruct from the original XML on every call.
 * No client-supplied prices or neutral payload are accepted here. The native
 * calculation remains authoritative; never issue or persist from this result. */
export function compareCiliaReviewedBudget(bytes:Uint8Array,catalog:CatalogItem[],steering:'left'|'right'|'unknown',review:CiliaScopeReview,configuration:PricingConfiguration,state:{revision:number;settings:PricingSettings}){
 const scope=assembleCiliaReviewedScope(bytes,catalog,steering,review)
 const result=planExternalBudget(scope.comparisonOnly,scope.mapping,catalog,configuration,state,{ciliaComparisonOnly:true})
 const plan='plan' in result?result.plan:undefined
 const externalServices=plan?.selected.filter(s=>servicePolicy(s.serviceId)?.execution==='external_confirmation').map(s=>({groupId:s.sourceId,serviceId:s.serviceId,dimensionId:s.dimensionId,authorizationVerified:false as const}))??[]
 // The motor marks inclusion of specialty lines as executionConfirmed. This
 // is only a simulation, so the presentation must not assert authorization.
 const calculation=plan?{...plan.calculation,lines:plan.calculation.lines.map(l=>l.execution==='external_confirmation'?{...l,executionConfirmed:false}:l)}:null
 const blockers=[...scope.blockers,'ATTENDANCE_IDENTITY_REVIEW','SOURCE_AUTHORIZATION_REVIEW',...(externalServices.length?['EXTERNAL_EXECUTION_REVIEW']:[]),...result.issues]
 return {kind:'cilia-native-comparison-v1' as const,state:result.state,financialMatch:result.state==='matched',scope,calculation,selected:plan?.selected??[],negotiation:plan?.negotiation??null,configurationRevision:configuration.revision,settingsRevision:state.revision,externalServices,blockers,requiresOperatorReview:true as const,canWrite:false as const}
}
