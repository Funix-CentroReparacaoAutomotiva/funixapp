// Quotation is independent of transcription/interpreting and never applies a plan.
export const QUOTE_CATEGORIES=['economica','equilibrada','original_nova'] as const
export type QuoteCategory=typeof QUOTE_CATEGORIES[number]
export interface QuoteQuery{brand:string;model:string;year:number|null;component:string;parent:string;side:'esquerdo'|'direito'|null}
export interface QuoteOffer{category:QuoteCategory;price:string;url:string;condition:'new'|'used';origin:'original'|'parallel';sourceQuote:string}
export interface QuoteResult{status:'found'|'empty'|'needs_details'|'unavailable';offers:QuoteOffer[];observedAt:string;expiresAt:string;cached:boolean}
// Aggregate fixed reasons only: no URL, title, excerpt or user identity.
export const QUOTE_REJECTION_REASONS=["structure","source","price","condition","text","price_evidence","price_mismatch","vehicle","component","excluded","direction","qualifiers","subcomponent","side","year","compatibility_evidence","condition_evidence","originality","official_source","quality_evidence"] as const
export type QuoteRejectionReason=typeof QUOTE_REJECTION_REASONS[number]
export interface QuoteMetrics{
 elapsedMs:number;webSearchCalls:number|null;inputTokens:number|null;outputTokens:number|null;estimatedUsd:number|null
 proposedOffers:number|null;acceptedOffers:number|null;rejected:number|null;rejectionReasons:Partial<Record<QuoteRejectionReason,number>>|null
 usableSources:number|null;usableCitations:number|null;status:string
}
// No secret, raw query, source excerpt or monetary result enters voice diagnostics.
export const quoteNames:Record<QuoteCategory,string>={economica:'Econômica',equilibrada:'Equilibrada',original_nova:'Original nova'}
