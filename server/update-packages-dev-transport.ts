import type { UpdatePackageIngest } from '../shared/update-packages.ts'
import { createSignedUpdatePackageRequest } from './update-packages-publish.ts'

/**
 * Opt-in development-only transport, without any built-in network client.
 * Callers inject a sender from a controlled test harness. This module MUST NOT
 * be wired into the production n8n workflow or normal server startup.
 */
export type DevelopmentSender = (
  request: {url:string;body:string;headers:Record<string,string>}
) => Promise<{status:number;body?:unknown}>

export async function deliverDevelopmentPackage(
  envelope:UpdatePackageIngest,
  settings:{
    enabled:boolean
    endpoint:string
    secret:string
    sender:DevelopmentSender
    now?:number
  }
):Promise<{status:number;body?:unknown}> {
  if(settings.enabled!==true)throw new Error('PACKAGE_DEV_TRANSPORT_DISABLED')
  let url:URL
  try{url=new URL(settings.endpoint)}catch{throw new Error('PACKAGE_DEV_ENDPOINT_INVALID')}
  if(url.protocol!=='http:' ||
    !['127.0.0.1','localhost','[::1]'].includes(url.hostname) ||
    url.username || url.password || url.search || url.hash ||
    url.pathname!=='/api/integrations/updates/packages') {
    throw new Error('PACKAGE_DEV_ENDPOINT_INVALID')
  }
  if(typeof settings.sender!=='function')throw new Error('PACKAGE_DEV_SENDER_INVALID')
  const signed=createSignedUpdatePackageRequest(envelope,settings.secret,settings.now)
  const result=await settings.sender({url:url.toString(),...signed})
  if(!result || !Number.isSafeInteger(result.status) ||
    result.status<200 || result.status>=300)throw new Error('PACKAGE_DEV_DELIVERY_FAILED')
  return result
}
