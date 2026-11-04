import type {RequestFailure} from './api.ts'

// These backend errors are returned before the definitive document is committed.
// A reserved OR may still exist: the caller must retain the same request key.
const notIssued:Readonly<Record<string,number>>={
 PDF_NOT_CONFIGURED:503,PDF_CONFIGURATION_INVALID:503,
 PDF_RENDER_UNAVAILABLE:503,PDF_RENDER_FAILURE:502,
 PDF_INVALID_RESPONSE:502,PDF_INCOMPLETE:502,PDF_TOO_LARGE:502,
 BUDGET_INCOMPLETE:422,VERSION_CONFLICT:409,DOCUMENT_NUMBER_LIMIT:503,
 INVALID_COMMERCIAL_DATA:400,INVALID_JSON:400,BODY_TOO_LARGE:413,
 AUTH_REQUIRED:401,ORIGIN_REJECTED:403,NOT_FOUND:404,
 METHOD_NOT_ALLOWED:405,JSON_REQUIRED:415,
}

export function emissionWasNotIssued(cause:unknown):boolean{
 if(!cause||typeof cause!=='object')return false
 const failure=cause as RequestFailure
 // Unreadable responses, connection failures and unknown HTTP errors remain uncertain.
 // In-progress/expired leases or a conflicting key may belong to an issued document.
 return failure.kind==='http'&&typeof failure.code==='string'&&
  Object.hasOwn(notIssued,failure.code)&&notIssued[failure.code]===failure.status
}
