import type {ChatEvent} from '../../shared/chat.ts'
import {digest,reliableIdentity} from './events.ts'
import {individualJid,type ConversationEvent} from './conversation-event.ts'
/** Upcast new authenticated V1 individual events into the existing local store.
 * Original V1 receipts remain handled by their original repository, never reprocessed.
 */
export function localEventFromV1(event:ChatEvent):ConversationEvent|null {
  const m=event.message
  if(event.instance!=='funix_comercial'||!reliableIdentity(m.remoteJid,m.messageId)||!individualJid.test(m.remoteJid!))return null
  const base={schemaVersion:2 as const,instance:event.instance,eventId:'schema1:'+digest([event.instance,event.eventId]),occurredAt:event.occurredAt}
  const identity={remoteJid:m.remoteJid!,remoteJidAlt:null,messageId:m.messageId!}
  if(event.type==='message.status'){
    const status={accepted:'SERVER_ACK',failed:'ERROR',delivered:'DELIVERY_ACK',read:'READ'}[event.message.status]
    return {...base,type:'message.status',message:{...identity,statuses:[status]}}
  }
  return {...base,type:'message.upsert',message:{...identity,timestamp:Math.floor(Date.parse(event.occurredAt)/1000),fromMe:event.message.fromMe,kind:event.message.kind,text:event.message.text,media:event.message.media?{mimeType:event.message.media.mime,bytes:event.message.media.bytes}:null}}
}
