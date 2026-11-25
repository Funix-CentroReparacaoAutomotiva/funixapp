import assert from 'node:assert/strict'
import {once} from 'node:events'
import {createHash, randomBytes, randomUUID} from 'node:crypto'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'
import {aiToolsHmlOrigin, aiToolsPath, aiToolsTokenHeader, initAiTools} from '../ai-tools.ts'
import {createApp} from '../app.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {openDatabase} from '../database.ts'

test('Ferramentas IA HML preservam autorização, recibos e registros após reiniciar', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'funix-ai-tools-'))
  const database = join(dir, 'synthetic.sqlite')
  const credentialsFile = join(dir, 'ai-tools.credentials.json')
  const readToken = randomBytes(32).toString('base64url')
  const writeToken = randomBytes(32).toString('base64url')
  const credential = (actor: string, token: string, scope: 'read' | 'write') =>
    ({actor, sha256: createHash('sha256').update(token).digest('hex'), scopes: [scope]})
  const reader = credential('qa-read', readToken, 'read')
  const writer = credential('qa-write', writeToken, 'write')
  writeFileSync(credentialsFile, JSON.stringify([reader, writer]), {mode: 0o600})
  const password = 'synthetic-operator-password'
  const id = randomUUID()
  const atKey = randomUUID()
  const titleKey = randomUUID()
  const scheduledEntry = '2027-01-06T10:30'
  const createInput = {phone: '+5511000000000', name: 'Atendimento sintético #362'}
  const titleInput = {kind: 'receivable', amountCents: 19991, counterparty: 'Cliente sintético', description: 'Teste #362', dueDate: '2027-01-18'}
  let atendimentoId = ''
  let titleId = ''
  let scheduledAt = ''

  async function run(phase: (request: typeof fetch, call: (token: string, operation: string, args: unknown, key?: string) => Promise<Response>) => Promise<void>, seed: boolean) {
    const db = openDatabase(database)
    const repo = new AtendimentoRepository(db)
    const app = createApp({atendimentos: repo, password, origin: aiToolsHmlOrigin, aiToolCredentials: initAiTools(db, aiToolsHmlOrigin, database)})
    try {
      if (seed) {
        assert.equal(initAiTools(db, 'https://app.funix.com.br', database), undefined)
        scheduledAt = repo.create({name: 'XP sintética', phone: '+5511000000001'}).id
        const party = JSON.stringify({id: null, text: 'Referência sintética'})
        db.prepare(`INSERT INTO production_experiences
          (id, atendimento_id, customer_json, vehicle_json, payer_json, scheduled_entry, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?)`).run(id, scheduledAt, party, party, party, '2027-01-05', '2027-01-01', '2027-01-01')
      }
      app.listen(0, '127.0.0.1')
      await once(app, 'listening')
      const address = app.address()
      assert(address && typeof address === 'object')
      const request: typeof fetch = (path, init) => fetch('http://127.0.0.1:' + address.port + path, init)
      await phase(request, (token, operation, args, key) => request(aiToolsPath, {
        method: 'POST', headers: {'Content-Type': 'application/json', [aiToolsTokenHeader]: token},
        body: JSON.stringify({operation, arguments: args, idempotencyKey: key}),
      }))
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    } finally {
      if (app.listening) {
        app.close()
        await once(app, 'close')
      }
      db.close()
    }
  }

  try {
    await run(async (request, call) => {
      assert.equal((await call('', 'atendimento.consultar', {id: scheduledAt})).status, 401)
      assert.equal((await call(randomBytes(32).toString('base64url'), 'atendimento.consultar', {id: scheduledAt})).status, 401)
      assert.equal((await call(readToken, 'atendimento.criar', createInput, atKey)).status, 403)
      assert.equal((await call(writeToken, 'financeiro.consultar', {})).status, 403)
      assert.equal((await call(writeToken, 'titulo.pagar', {}, randomUUID())).status, 404)
      assert.equal((await call(writeToken, 'atendimento.criar', createInput)).status, 400)
      assert.equal((await request('/api/financeiro', {headers: {[aiToolsTokenHeader]: readToken}})).status, 401)
      assert.equal((await (await call(readToken, 'atendimento.consultar', {id: scheduledAt})).json()).id, scheduledAt)
      const experience = await (await call(readToken, 'experiencia.consultar', {atendimentoId: scheduledAt})).json()
      assert.equal(experience.id, id)

      const [first, second] = await Promise.all([
        call(writeToken, 'atendimento.criar', createInput, atKey),
        call(writeToken, 'atendimento.criar', {name: createInput.name, phone: createInput.phone}, atKey),
      ])
      const receipts = await Promise.all([first.json(), second.json()])
      atendimentoId = receipts[0].id
      assert.ok(atendimentoId)
      assert.equal(receipts[1].id, atendimentoId)
      assert.equal(receipts.filter(item => item.replayed).length, 1)
      assert.ok(receipts.every(item => item.persisted))
      assert.equal((await call(writeToken, 'atendimento.criar', {...createInput, name: 'Outro'}, atKey)).status, 409)

      const reschedule = {atendimentoId: scheduledAt, scheduledEntry, expectedAtendimentoRevision: experience.data.atendimentoRevision,
        expectedExperienceRevision: experience.data.experience.revision}
      assert.equal((await call(writeToken, 'agendamento.alterar', {...reschedule, expectedExperienceRevision: 0}, randomUUID())).status, 409)
      const scheduled = await (await call(writeToken, 'agendamento.alterar', reschedule, randomUUID())).json()
      assert.equal(scheduled.data.experience.scheduledEntry, scheduledEntry)
      assert.equal(scheduled.persisted, true)

      const before = await (await call(readToken, 'financeiro.consultar', {})).json()
      assert.equal(before.data.pendingCents.receivable, '0')
      assert.equal((await call(writeToken, 'titulo.criar', {...titleInput, amountCents: 0}, titleKey)).status, 400)
      assert.equal((await call(writeToken, 'titulo.criar', {...titleInput, experienceId: randomUUID()}, titleKey)).status, 404)
      const title = await (await call(writeToken, 'titulo.criar', titleInput, titleKey)).json()
      titleId = title.id
      assert.ok(titleId)
      assert.equal(title.persisted, true)
      const duplicate = await (await call(writeToken, 'titulo.criar', titleInput, titleKey)).json()
      assert.equal(duplicate.id, titleId)
      assert.equal(duplicate.replayed, true)

      writeFileSync(credentialsFile, JSON.stringify([reader]))
      assert.equal((await call(writeToken, 'titulo.criar', titleInput, randomUUID())).status, 401)
      writeFileSync(credentialsFile, JSON.stringify([reader, writer]), {mode: 0o600})
    }, true)

    await run(async (request, call) => {
      const at = await (await call(readToken, 'atendimento.consultar', {id: atendimentoId})).json()
      assert.equal(at.data.name, createInput.name)
      assert.equal((await (await call(readToken, 'atendimento.buscar', {q: createInput.name})).json()).data.total, 1)
      const xp = await (await call(readToken, 'experiencia.consultar', {atendimentoId: scheduledAt})).json()
      assert.equal(xp.data.experience.scheduledEntry, scheduledEntry)
      const title = await (await call(readToken, 'titulo.consultar', {id: titleId})).json()
      assert.equal(title.data.balanceCents, titleInput.amountCents)
      const after = await (await call(readToken, 'financeiro.consultar', {})).json()
      assert.deepEqual(after.data.pendingCents, {receivable: '19991', payable: '0'})
      assert.equal((await (await call(writeToken, 'atendimento.criar', createInput, atKey)).json()).replayed, true)

      const session = await request('/api/session', {method: 'POST',
        headers: {Origin: aiToolsHmlOrigin, 'Content-Type': 'application/json'}, body: JSON.stringify({password})})
      assert.equal(session.status, 200)
      const cookie = session.headers.get('set-cookie')!.split(';')[0]!
      const ui = (path: string) => request(path, {headers: {Cookie: cookie}})
      assert.equal((await (await ui('/api/atendimentos/' + atendimentoId)).json()).id, atendimentoId)
      assert.equal((await (await ui('/api/atendimentos/' + scheduledAt + '/experiencia')).json()).experience.scheduledEntry, scheduledEntry)
      assert.equal((await (await ui('/api/financeiro')).json()).titles[0].id, titleId)
    }, false)

    const db = openDatabase(database)
    try {
      const audit = db.prepare('SELECT actor, operation, record_id, change_json FROM ai_tool_mutations').all()
      assert.equal(audit.length, 3)
      assert.ok(audit.every(row => row.actor === 'qa-write'))
      assert.deepEqual(JSON.parse(String(audit.find(row => row.record_id === id)!.change_json)),
        {atendimentoId: scheduledAt, before: '2027-01-05', after: scheduledEntry, revision: 2})
    } finally {db.close()}
  } finally {rmSync(dir, {recursive: true, force: true})}
})
