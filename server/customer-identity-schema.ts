import type {DatabaseSync} from 'node:sqlite'
import {normalizeCustomerPhone} from './phone.ts'

export function registerCustomerPhoneFunction(db:DatabaseSync) {
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
