import { preparePendingGmailPackage } from './update-packages-n8n-pending.ts'
import type { PendingN8nGmailDraft } from './update-packages-n8n-pending.ts'
import { createSignedUpdatePackageRequest } from './update-packages-publish.ts'

/**
 * Single fail-closed handoff for the Gmail n8n draft contract.
 * Validates before signing; never sends HTTP or executes proposed actions.
 * The n8n workflow is still inactive and not wired to this helper.
 */
export function prepareSignedPendingGmailRequest(
  input: unknown, secret: string, now: number = Date.now()
): {body:string;headers:Record<string,string>} {
  const envelope=preparePendingGmailPackage(input as PendingN8nGmailDraft)
  return createSignedUpdatePackageRequest(envelope,secret,now)
}
