import {createHash} from 'node:crypto'
import type {DatabaseSync} from 'node:sqlite'
import {ConversationIdentities} from './conversation-identities.ts'
import {LocalConversationAssociations} from './local-associations.ts'
import {ShortNumberReview,reviewNumberPair} from './short-number-review.ts'
import {transaction} from '../scenarios.ts'

const instance = 'funix_comercial'

/** Recover evidenced short-number orphans with or without an autonomous hold. */
export function planShortNumberRecovery(db:DatabaseSync, since:string) {
  if(!db.isTransaction)throw Error('A leitura do plano requer uma transação.')
  if(!Number.isFinite(Date.parse(since))||new Date(since).toISOString()!==since)
    throw Error('Configure o corte da recepção autônoma em UTC antes de recuperar.')
  const view=db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='chat_confirmed_short_numbers'").get()
  if(!view)throw Error('O banco não possui a extensão de revisão de numeração.')
  const identities=new ConversationIdentities(db),review=new ShortNumberReview(db,()=>false)
  const rows=db.prepare(`SELECT p.id,p.remote_jid FROM chat_provider_conversations p
    WHERE p.instance=? AND (
      EXISTS(SELECT 1 FROM chat_local_context_holds h
        WHERE h.conversation_id=p.id AND h.reason='autonomous_contact_conflict')
      OR (p.remote_jid GLOB '55[0-9][0-9][6-9]???????@s.whatsapp.net'
        AND EXISTS(SELECT 1 FROM chat_conversations c JOIN chat_messages m ON m.conversation_id=c.id
          WHERE c.instance=p.instance AND (c.remote_jid=p.remote_jid OR EXISTS(
            SELECT 1 FROM chat_provider_alias_evidence a
            WHERE a.instance=p.instance AND a.pn=p.remote_jid AND a.lid=c.remote_jid))))
    ) ORDER BY p.id`).all(instance)
  const counts={eligible:0,existingOrRevoked:0,needsIdentityReview:0,noAuthenticatedMessage:0}
  const seen=new Set<string>(),eligible:{id:string;sequence:number}[]=[]
  for(const row of rows){
    const id=String(row.id),jid=String(row.remote_jid),members=identities.identityJids(jid)
    if(!members){counts.needsIdentityReview++;continue}
    const pn=members.find(member=>member.endsWith('@s.whatsapp.net'))
    if(!pn||!reviewNumberPair(pn)||seen.has(pn))continue
    seen.add(pn)
    const marks=members.map(()=>'?').join(',')
    const divergingHandle=db.prepare(`SELECT 1 FROM chat_provider_conversations p JOIN v20_conversations v
      ON v.instance=p.instance AND v.remote_jid=p.remote_jid
      WHERE p.instance=? AND p.remote_jid IN (${marks}) AND p.id<>v.id LIMIT 1`).get(instance,...members)
    if(divergingHandle){counts.needsIdentityReview++;continue}
    const prior=db.prepare(`SELECT 1 FROM v20_conversations v LEFT JOIN v20_associations a ON a.conversation_id=v.id
      WHERE v.instance=? AND v.remote_jid IN (${marks}) AND (a.id IS NOT NULL OR v.context_revision>0)
      UNION ALL SELECT 1 FROM chat_links l JOIN chat_conversations c ON c.id=l.conversation_id
      WHERE c.instance=? AND c.remote_jid IN (${marks})
      UNION ALL SELECT 1 FROM conversation_initialization i JOIN chat_provider_conversations p ON p.id=i.conversation_id
      WHERE p.instance=? AND p.remote_jid IN (${marks}) AND (i.atendimento_id IS NOT NULL OR i.decision='closed') LIMIT 1`)
      .get(instance,...members,instance,...members,instance,...members)
    if(prior){counts.existingOrRevoked++;continue}
    const otherHold=db.prepare(`SELECT 1 FROM chat_local_context_holds h JOIN chat_provider_conversations p ON p.id=h.conversation_id
      WHERE p.instance=? AND p.remote_jid IN (${marks}) AND h.reason<>'autonomous_contact_conflict' LIMIT 1`)
      .get(instance,...members)
    if(otherHold||!review.triageCandidate(id)){counts.needsIdentityReview++;continue}
    const evidence=db.prepare(`SELECT MAX(e.sequence) AS sequence FROM chat_events e
      JOIN chat_messages m ON m.message_id=json_extract(CASE WHEN json_valid(e.payload) THEN e.payload END,'$.message.messageId')
      JOIN chat_conversations c ON c.id=m.conversation_id AND c.instance=e.instance
      WHERE e.instance=? AND c.remote_jid IN (${marks}) AND e.occurred_at>=? AND m.occurred_at>=?
        AND e.disposition IN ('pending','projected') AND CASE WHEN json_valid(e.payload) THEN
          json_extract(e.payload,'$.type')='message.upsert' AND COALESCE(json_extract(e.payload,'$.selfChat'),0)=0 AND
          (json_extract(e.payload,'$.message.remoteJid') IN (${marks}) OR json_extract(e.payload,'$.message.remoteJidAlt') IN (${marks})) END`)
      .get(instance,...members,since,since,...members,...members)
    if(typeof evidence?.sequence!=='number'){counts.noAuthenticatedMessage++;continue}
    eligible.push({id,sequence:evidence.sequence})
  }
  counts.eligible=eligible.length
  const digest=createHash('sha256').update(JSON.stringify({since,eligible,counts})).digest('hex')
  return {eligible,digest,counts}
}

export function applyShortNumberRecovery(db:DatabaseSync,since:string,expectedDigest:string){
  return transaction(db,()=>{
    const plan=planShortNumberRecovery(db,since)
    if(plan.digest!==expectedDigest)throw Error('O plano mudou. Confira uma nova prévia antes de aplicar.')
    const authority=new LocalConversationAssociations(db,undefined,true)
    for(const item of plan.eligible){
      if(!authority.createTriageFromHistory(item.id,true).created)throw Error('A triagem mudou durante a recuperação.')
    }
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('A recuperação encontrou vínculos inconsistentes.')
    return {digest:plan.digest,counts:plan.counts,applied:plan.eligible.length}
  })
}
