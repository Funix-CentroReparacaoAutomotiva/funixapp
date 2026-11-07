// Quotation is independent of transcription/interpreting and never applies a plan.
export const QUOTE_CATEGORIES=['economica','equilibrada','original_nova'] as const
export type QuoteCategory=typeof QUOTE_CATEGORIES[number]
export interface QuoteQuery{brand:string;model:string;year:number|null;component:string;parent:string;side:'esquerdo'|'direito'|null}
export interface QuoteOffer{category:QuoteCategory;price:string;url:string;condition:'new'|'used';origin:'original'|'parallel';sourceQuote:string}
export interface QuoteResult{status:'found'|'empty'|'needs_details'|'unavailable';offers:QuoteOffer[];observedAt:string;expiresAt:string;cached:boolean}
export interface QuoteMetrics{elapsedMs:number;webSearchCalls:number|null;inputTokens:number|null;outputTokens:number|null;estimatedUsd:number|null;rejected:number;status:string}
// No secret, raw query, source excerpt or monetary result enters voice diagnostics.
export const quoteNames:Record<QuoteCategory,string>={economica:'Econômica',equilibrada:'Equilibrada',original_nova:'Original nova'}
