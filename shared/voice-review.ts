// Presentation metadata only. Never accepted by the application endpoint.
export interface VoiceReviewField {label:string;before?:string;after:string}
export interface VoiceReviewEntry {
 kind:'add'|'remove'|'change'|'pending'|'warning'
 label:string
 scope:'shared'|'scenario'|'global'
 fields:VoiceReviewField[]
 warning?:string
}
export interface VoiceReviewGroup {id:string;piece:string;entries:VoiceReviewEntry[]}
