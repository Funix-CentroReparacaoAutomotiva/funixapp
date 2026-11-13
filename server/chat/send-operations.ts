import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { ServiceError } from '../errors.ts'

export function createSendOperationSchema(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_send_operations (
  request_id TEXT PRIMARY KEY, scope TEXT NOT NULL, digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('sending','accepted','uncertain')), message_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS chat_one_active_send ON chat_send_operations(scope) WHERE state='sending';`)
}
export type SendCommand = { requestId: string; contextToken: string }
export class SendOperations {
  private readonly db: DatabaseSync
  constructor(db: DatabaseSync) {
    this.db = db
  }
  async run(
    command: SendCommand,
    scope: string,
    payload: unknown,
    send: () => Promise<{ messageId: string }>,
  ) {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        command.requestId,
      ) ||
      !/^[a-f0-9]{64}$/.test(command.contextToken)
    )
      throw new ServiceError(400, 'CHAT_SEND_INVALID', 'Operação de envio inválida.')
    const digest = createHash('sha256')
      .update(JSON.stringify([scope, command.contextToken, payload]))
      .digest('hex')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const old = this.db
        .prepare('SELECT * FROM chat_send_operations WHERE request_id=?')
        .get(command.requestId)
      if (old) {
        if (old.digest !== digest)
          throw new ServiceError(409, 'CHAT_SEND_CONFLICT', 'A operação de envio mudou.')
        this.db.exec('COMMIT')
        if (old.state === 'accepted') return { messageId: String(old.message_id) }
        // Includes a process crash between provider side effect and local receipt.
        throw new ServiceError(
          409,
          'CHAT_SEND_UNCERTAIN',
          'Resultado incerto. Confira o WhatsApp; esta operação não será repetida.',
        )
      }
      if (
        this.db
          .prepare("SELECT 1 FROM chat_send_operations WHERE scope=? AND state='sending'")
          .get(scope)
      )
        throw new ServiceError(
          409,
          'CHAT_SEND_IN_PROGRESS',
          'Há um envio em andamento nesta conversa.',
        )
      const now = new Date().toISOString()
      this.db
        .prepare("INSERT INTO chat_send_operations VALUES(?,?,?,'sending',NULL,?,?)")
        .run(command.requestId, scope, digest, now, now)
      this.db.exec('COMMIT')
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK')
      throw error
    }
    try {
      const receipt = await send()
      this.db
        .prepare(
          "UPDATE chat_send_operations SET state='accepted',message_id=?,updated_at=? WHERE request_id=?",
        )
        .run(receipt.messageId, new Date().toISOString(), command.requestId)
      return receipt
    } catch (error) {
      this.db
        .prepare(
          "UPDATE chat_send_operations SET state='uncertain',updated_at=? WHERE request_id=?",
        )
        .run(new Date().toISOString(), command.requestId)
      throw error
    }
  }
  /** Startup recovery never attempts another network side effect. Single backend process owns dispatch. */
  recoverInterrupted() {
    this.db.prepare("UPDATE chat_send_operations SET state='uncertain' WHERE state='sending'").run()
  }
}
