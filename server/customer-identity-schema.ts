import type {DatabaseSync} from 'node:sqlite'
import {normalizeCustomerPhone} from './phone.ts'

type OwnerChange = {contactId:string;previousOwnerId:string;ownerId:string}
// A SQL receipt is audit evidence, not authorization. The trigger checks this
// connection-local approval only during the confirmed write.
const approvedOwnerChanges = new WeakMap<DatabaseSync,OwnerChange>()

export function withConfirmedOwnerChange<T>(db:DatabaseSync,change:OwnerChange,write:()=>T):T {
  if(!db.isTransaction||approvedOwnerChanges.has(db))throw Error('Invalid owner confirmation transaction')
  approvedOwnerChanges.set(db,change)
  try{return write()}
  finally{approvedOwnerChanges.delete(db)}
}

export function registerCustomerPhoneFunction(db:DatabaseSync) {
  db.function('funix_confirmed_owner_change',(contactId,previousOwnerId,ownerId)=>{
    const approved=approvedOwnerChanges.get(db)
    return approved&&approved.contactId===contactId&&approved.previousOwnerId===previousOwnerId&&approved.ownerId===ownerId?1:0
  })
  db.function('funix_customer_phone',{deterministic:true},value=>typeof value==='string'?normalizeCustomerPhone(value):null)
}

/** V25. Preflight every key before writing inside the migration transaction. */
export function createCustomerIdentitySchema(db:DatabaseSync) {
  const contacts=db.prepare("SELECT id,data FROM customer_records WHERE kind='contact'").all()
    .map(row=>({id:String(row.id),phone:normalizeCustomerPhone(String(JSON.parse(String(row.data)).text??''))}))
  const counts=new Map<string,number>()
  for(const {phone} of contacts)if(phone)counts.set(phone,(counts.get(phone)??0)+1)
  const collisions=[...counts.values()].filter(count=>count>1)
  if(collisions.length)throw Error(`V25 bloqueada: ${collisions.length} grupos de telefone duplicado (${collisions.reduce((total,count)=>total+count,0)} Contatos). Execute o inventário offline em uma cópia e revise os grupos antes de migrar.`)
  const update=db.prepare('UPDATE customer_records SET phone_normalized=? WHERE id=? AND phone_normalized IS NOT ?')
  for(const {id,phone} of contacts)update.run(phone,id,phone)
  db.exec(`CREATE UNIQUE INDEX customer_contact_phone_unique
    ON customer_records(phone_normalized) WHERE kind='contact' AND phone_normalized IS NOT NULL;
    CREATE TRIGGER customer_phone_key_insert BEFORE INSERT ON customer_records
    WHEN NEW.kind='contact' AND NEW.phone_normalized IS NOT funix_customer_phone(json_extract(NEW.data,'$.text'))
    BEGIN SELECT RAISE(ABORT,'Invalid canonical contact phone'); END;
    CREATE TRIGGER customer_phone_key_update BEFORE UPDATE OF kind,data,phone_normalized ON customer_records
    WHEN NEW.kind='contact' AND NEW.phone_normalized IS NOT funix_customer_phone(json_extract(NEW.data,'$.text'))
    BEGIN SELECT RAISE(ABORT,'Invalid canonical contact phone'); END;
    CREATE VIEW customer_channel_contacts AS
    SELECT v.id AS conversation_id,c.id AS contact_id
    FROM v20_conversations v
    JOIN chat_provider_conversations p ON p.instance=v.instance AND
      (p.remote_jid=v.remote_jid OR EXISTS(
        SELECT 1 FROM chat_provider_alias_evidence a WHERE a.instance=v.instance
        AND ((a.pn=p.remote_jid AND a.lid=v.remote_jid) OR (a.lid=p.remote_jid AND a.pn=v.remote_jid))
        AND NOT EXISTS (
          SELECT 1 FROM chat_provider_alias_evidence x WHERE x.instance=a.instance
          AND ((x.pn=a.pn AND x.lid<>a.lid) OR (x.lid=a.lid AND x.pn<>a.pn))
        )
      ))
    JOIN customer_records c ON c.conversation_id=p.id AND c.kind='contact'
    JOIN customer_records e ON e.id=c.entity_id AND e.kind='entity'
    WHERE json_extract(c.data,'$.canonicalContactId') IS NULL
    AND CASE
      WHEN v.remote_jid LIKE '%@s.whatsapp.net' THEN
        c.phone_normalized = '+' || substr(v.remote_jid,1,instr(v.remote_jid,'@')-1)
      WHEN EXISTS (SELECT 1 FROM chat_provider_alias_evidence a WHERE a.instance=v.instance AND a.lid=v.remote_jid) THEN
        EXISTS (SELECT 1 FROM chat_provider_alias_evidence a WHERE a.instance=v.instance AND a.lid=v.remote_jid
          AND c.phone_normalized = '+' || substr(a.pn,1,instr(a.pn,'@')-1))
      ELSE v.remote_jid LIKE '%@lid' AND c.phone_normalized IS NULL AND json_extract(c.data,'$.text')=''
    END
    AND NOT EXISTS (
      SELECT 1 FROM chat_provider_alias_evidence a
      JOIN chat_provider_alias_evidence x ON x.instance=a.instance
      AND ((x.pn=a.pn AND x.lid<>a.lid) OR (x.lid=a.lid AND x.pn<>a.pn))
      WHERE a.instance=v.instance AND v.remote_jid IN (a.pn,a.lid)
    );
    CREATE TRIGGER customer_association_contact_insert BEFORE INSERT ON v20_associations
    WHEN (SELECT COUNT(*) FROM customer_channel_contacts WHERE conversation_id=NEW.conversation_id)<>1
    BEGIN SELECT RAISE(ABORT,'Commercial association requires a canonical contact'); END;
    CREATE TRIGGER customer_association_contact_update BEFORE UPDATE OF conversation_id,atendimento_id,unlinked_at ON v20_associations
    WHEN NEW.unlinked_at IS NULL AND (SELECT COUNT(*) FROM customer_channel_contacts WHERE conversation_id=NEW.conversation_id)<>1
    BEGIN SELECT RAISE(ABORT,'Commercial association requires a canonical contact'); END;
    CREATE TRIGGER customer_active_channel_update BEFORE UPDATE OF kind,entity_id,conversation_id,phone_normalized,data ON customer_records
    WHEN EXISTS (
      SELECT 1 FROM customer_channel_contacts c JOIN v20_associations a USING(conversation_id)
      WHERE c.contact_id=OLD.id AND a.unlinked_at IS NULL
    ) AND (
      NEW.kind <> 'contact' OR NEW.conversation_id IS NOT OLD.conversation_id
      OR NEW.phone_normalized IS NOT OLD.phone_normalized
      OR json_extract(NEW.data,'$.canonicalContactId') IS NOT NULL
      OR (OLD.phone_normalized IS NULL AND json_extract(NEW.data,'$.text') IS NOT '')
      OR NOT EXISTS (SELECT 1 FROM customer_records e WHERE e.id=NEW.entity_id AND e.kind='entity')
    )
    BEGIN SELECT RAISE(ABORT,'Active commercial association requires its canonical contact'); END;
    CREATE TRIGGER customer_contact_owner_transfer BEFORE UPDATE OF entity_id ON customer_records
    WHEN OLD.kind='contact' AND OLD.entity_id IS NOT NULL AND NEW.entity_id IS NOT OLD.entity_id
    AND CASE WHEN NEW.entity_id IS NULL THEN 1
      WHEN NOT EXISTS (SELECT 1 FROM customer_records e WHERE e.id=OLD.entity_id
        AND e.kind='entity' AND json_extract(e.data,'$.channelProvisional')=1) THEN 1
      WHEN EXISTS (SELECT 1 FROM atendimento_references WHERE record_id=OLD.entity_id) THEN 1
      ELSE funix_confirmed_owner_change(OLD.id,OLD.entity_id,NEW.entity_id)<>1 END
    BEGIN SELECT RAISE(ABORT,'Contact owner transfer requires explicit confirmation'); END;
    CREATE TRIGGER customer_active_channel_delete BEFORE DELETE ON customer_records
    WHEN EXISTS (
      SELECT 1 FROM customer_channel_contacts c JOIN v20_associations a USING(conversation_id)
      WHERE c.contact_id=OLD.id AND a.unlinked_at IS NULL
    )
    BEGIN SELECT RAISE(ABORT,'Active commercial association requires its canonical contact'); END;
    CREATE TRIGGER customer_channel_owner_kind BEFORE UPDATE OF kind ON customer_records
    WHEN NEW.kind<>'entity' AND EXISTS (
      SELECT 1 FROM customer_records r JOIN customer_channel_contacts c ON c.contact_id=r.id
      JOIN v20_associations a ON a.conversation_id=c.conversation_id WHERE r.entity_id=OLD.id AND a.unlinked_at IS NULL
    )
    BEGIN SELECT RAISE(ABORT,'Active commercial association requires a contact owner'); END;
    CREATE TRIGGER customer_archived_contact_update BEFORE UPDATE ON customer_records
    WHEN json_extract(OLD.data,'$.canonicalContactId') IS NOT NULL
    BEGIN SELECT RAISE(ABORT,'Archived contact is immutable'); END`)
}

/** Optional extension of V25. Older application images can still open the database. */
export function createShortNumberReviewSchema(db:DatabaseSync) {
  if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='chat_confirmed_short_numbers'").get())return
  const previous=db.prepare("SELECT sql FROM sqlite_schema WHERE name='customer_channel_contacts' AND type='view'").get()?.sql
  const exact=String(previous??'').replace(/^CREATE VIEW customer_channel_contacts AS\s+/i,'')
  if(!exact.startsWith('SELECT '))throw Error('Canonical Contact view unavailable')
  db.exec(`
    CREATE TABLE chat_confirmed_short_numbers (
      conversation_id TEXT PRIMARY KEY REFERENCES chat_provider_conversations(id),
      contact_id TEXT NOT NULL UNIQUE REFERENCES customer_records(id),
      entity_id TEXT NOT NULL REFERENCES customer_records(id),
      atendimento_id TEXT NOT NULL REFERENCES atendimentos(id),
      observed_phone TEXT NOT NULL,
      registered_phone TEXT NOT NULL,
      request_id TEXT NOT NULL,
      confirmed_at TEXT NOT NULL,
      reason TEXT NOT NULL
    );
    DROP VIEW customer_channel_contacts;
    CREATE VIEW customer_channel_contacts AS ${exact}
    UNION SELECT v.id AS conversation_id, c.id AS contact_id
      FROM chat_confirmed_short_numbers s
      JOIN chat_provider_conversations p ON p.id=s.conversation_id
      JOIN v20_conversations v ON v.instance=p.instance AND (v.remote_jid=p.remote_jid OR EXISTS (
        SELECT 1 FROM chat_provider_alias_evidence a WHERE a.instance=p.instance
        AND a.pn=substr(s.observed_phone,2)||'@s.whatsapp.net' AND p.remote_jid IN (a.pn,a.lid) AND v.remote_jid IN (a.pn,a.lid)
        AND NOT EXISTS (SELECT 1 FROM chat_provider_alias_evidence x WHERE x.instance=a.instance
          AND ((x.pn=a.pn AND x.lid<>a.lid) OR (x.lid=a.lid AND x.pn<>a.pn)))
      ))
      JOIN customer_records c ON c.id=s.contact_id AND c.kind='contact' AND c.entity_id=s.entity_id
        AND c.phone_normalized=s.registered_phone AND c.conversation_id=p.id
        AND json_extract(c.data,'$.canonicalContactId') IS NULL
      JOIN customer_records e ON e.id=c.entity_id AND e.kind='entity'
      WHERE NOT EXISTS (SELECT 1 FROM chat_provider_alias_evidence a JOIN chat_provider_alias_evidence x ON x.instance=a.instance
        AND ((x.pn=a.pn AND x.lid<>a.lid) OR (x.lid=a.lid AND x.pn<>a.pn))
        WHERE a.instance=p.instance AND p.remote_jid IN (a.pn,a.lid))
    UNION SELECT v.id AS conversation_id, c.id AS contact_id
      FROM customer_records c JOIN customer_records e ON e.id=c.entity_id AND e.kind='entity'
      JOIN chat_provider_conversations p ON p.id=c.conversation_id
      JOIN v20_conversations v ON v.instance=p.instance AND v.remote_jid=p.remote_jid
      WHERE c.kind='contact' AND c.phone_normalized IS NULL AND json_extract(c.data,'$.text')=''
        AND json_extract(c.data,'$.shortNumberReviewPending')=1
        AND json_extract(c.data,'$.canonicalContactId') IS NULL
        AND COALESCE((SELECT a.pn FROM chat_provider_alias_evidence a WHERE a.instance=p.instance AND a.lid=p.remote_jid),p.remote_jid)
          GLOB '55[0-9][0-9][6-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]@s.whatsapp.net'
        AND NOT EXISTS (SELECT 1 FROM chat_provider_alias_evidence a JOIN chat_provider_alias_evidence x ON x.instance=a.instance
          AND ((x.pn=a.pn AND x.lid<>a.lid) OR (x.lid=a.lid AND x.pn<>a.pn))
          WHERE a.instance=p.instance AND p.remote_jid IN (a.pn,a.lid));
    CREATE TRIGGER chat_short_number_context_insert BEFORE INSERT ON v20_active_context
    WHEN EXISTS(SELECT 1 FROM v20_associations a JOIN customer_channel_contacts c USING(conversation_id)
      JOIN customer_records r ON r.id=c.contact_id LEFT JOIN chat_confirmed_short_numbers s ON s.contact_id=c.contact_id
      WHERE a.id=NEW.link_id AND (s.contact_id IS NOT NULL OR json_extract(r.data,'$.shortNumberReviewPending')=1))
    BEGIN SELECT RAISE(ABORT,'Reviewed historical number cannot authorize sending'); END;
    CREATE TRIGGER chat_short_number_context_update BEFORE UPDATE ON v20_active_context
    WHEN EXISTS(SELECT 1 FROM v20_associations a JOIN customer_channel_contacts c USING(conversation_id)
      JOIN customer_records r ON r.id=c.contact_id LEFT JOIN chat_confirmed_short_numbers s ON s.contact_id=c.contact_id
      WHERE a.id=NEW.link_id AND (s.contact_id IS NOT NULL OR json_extract(r.data,'$.shortNumberReviewPending')=1))
    BEGIN SELECT RAISE(ABORT,'Reviewed historical number cannot authorize sending'); END;
    CREATE TRIGGER chat_short_number_receipt_update BEFORE UPDATE ON chat_confirmed_short_numbers
    BEGIN SELECT RAISE(ABORT,'Reviewed historical number receipt is immutable'); END;
    CREATE TRIGGER chat_short_number_receipt_delete BEFORE DELETE ON chat_confirmed_short_numbers
    BEGIN SELECT RAISE(ABORT,'Reviewed historical number receipt is immutable'); END;
  `)
}
