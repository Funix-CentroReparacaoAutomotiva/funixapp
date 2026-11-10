import { prepareSignedPendingGmailRequest } from './update-packages-n8n-handoff.ts'

/**
 * No network client is built into this module. A segregated staging harness
 * injects an HTTPS sender. Real n8n/ERP/Drive connections are intentionally
 * NOT part of this implementation.
 */
export type StagingResponse = {
  status:number
  headers?:Record<string,string>
  body?:unknown
}
export type StagingRequest = {
  url:string
  body:string
  headers:Record<string,string>
  redirect:'error'
}
export type StagingSender = (request:StagingRequest)=>Promise<StagingResponse>

const permittedPath='/api/integrations/updates/packages'
const forbiddenHosts=new Set(['localhost','127.0.0.1','0.0.0.0','[::1]'])

function checkedEndpoint(raw:string, expectedOrigin:string):string {
  let target:URL, origin:URL
  try {target=new URL(raw);origin=new URL(expectedOrigin)}
  catch {throw new Error('STAGING_ENDPOINT_INVALID')}
  if (target.protocol!=='https:' || origin.protocol!=='https:' ||
      target.username || target.password || target.search || target.hash ||
      origin.username || origin.password || origin.search || origin.hash ||
      origin.pathname!=='/' || !target.hostname || forbiddenHosts.has(target.hostname) ||
      target.hostname!==origin.hostname || target.port!==origin.port ||
      target.pathname!==permittedPath ||
      !/(?:^|[.-])(?:staging|homolog|sandbox|test)(?:[.-]|$)/i.test(target.hostname))
      throw new Error('STAGING_ENDPOINT_INVALID')
  return target.toString()
}

function receipt(value:unknown):{packageId:string;status:'awaiting_review';revision:number;snapshotHash:string} {
  if(!value || typeof value!=='object') throw new Error('STAGING_RECEIPT_INVALID')
  const p=value as Record<string,unknown>
  if(typeof p.packageId!=='string' || !/^[0-9a-f-]{36}$/i.test(p.packageId) ||
     p.status!=='awaiting_review' ||
     typeof p.revision!=='number' || !Number.isSafeInteger(p.revision) || p.revision<1 ||
     typeof p.snapshotHash!=='string' || !/^[a-f0-9]{64}$/.test(p.snapshotHash))
    throw new Error('STAGING_RECEIPT_INVALID')
  return {packageId:p.packageId,status:'awaiting_review',revision:p.revision,snapshotHash:p.snapshotHash}
}

/**
 * Approval of this transport is separate from approval of changes.
 * It can ingest an unverified, BLOCKED card into an isolated staging app,
 * but cannot mark it ready, approve it, or execute any proposed actions.
 */
export async function deliverStagingGmailDraft(
  draft:unknown,
  settings:{
    enabled:boolean
    isolatedEnvironment:boolean
    endpoint:string
    expectedOrigin:string
    secret:string
    sender:StagingSender
    now?:number
  }
):Promise<{packageId:string;status:'awaiting_review';revision:number;snapshotHash:string}> {
  if(settings?.enabled!==true || settings?.isolatedEnvironment!==true)
    throw new Error('STAGING_TRANSPORT_DISABLED')
  const url=checkedEndpoint(settings.endpoint,settings.expectedOrigin)
  if(typeof settings.sender!=='function')throw new Error('STAGING_SENDER_MISSING')
  const signed=prepareSignedPendingGmailRequest(draft,settings.secret,settings.now)
  const result=await settings.sender({
    url,body:signed.body,headers:{...signed.headers},redirect:'error'
  })
  if(!result || result.status!==202)throw new Error('STAGING_DELIVERY_REJECTED')
  return receipt(result.body)
}
