import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { openDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { CommercialRepository } from '../commercial.ts'
import { hierarchy, hierarchyPieces } from '../hierarchy.ts'
import { ServiceError } from '../errors.ts'

const invalid = (error: unknown) => error instanceof ServiceError && error.status === 400
const conflict = (error: unknown) => error instanceof ServiceError && error.status === 409
function setup() {
  const db = openDatabase(':memory:')
  const repo = new CommercialRepository(db)
  const atendimento = new AtendimentoRepository(db).create({ phone: '123' })
  const validate = (code: string) => {
    const item = repo.catalogs().items.find(item => item.code === code)!
    return repo.saveCatalog({ revision: item.revision, status: 'validado' }, item.id)
  }
  const service = () => repo.saveCatalog({ kind: 'servico', name: 'Serviço sintético', status: 'validado' })
  return { db, repo, atendimento, validate, service }
}

test('upgrades actual M1.1 SQL without changing any Atendimento field or table definition; reopen is idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'funix-upgrade-')), file = join(dir, 'v1.sqlite')
  try {
    let db = new DatabaseSync(file)
    db.exec(readFileSync(new URL('./fixtures/m1_1_schema.sql', import.meta.url), 'utf8'))
    const repo = new AtendimentoRepository(db)
    const first = repo.create({ phone: '123', name: 'Sintético preservado', notes: 'Não apagar', plate: 'QA-001' })
    repo.update(first.id, { revision: first.revision, stage: 'rejeitados', explicitRefusal: true, rejectionReason: 'Teste preservado' })
    repo.create({ phone: '123' })
    const rows = db.prepare('SELECT * FROM atendimentos ORDER BY id').all()
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name='atendimentos'").get()
    db.close()
    for (let i = 0; i < 2; i++) {
      db = openDatabase(file)
      assert.deepEqual(db.prepare('SELECT * FROM atendimentos ORDER BY id').all(), rows)
      assert.deepEqual(db.prepare("SELECT sql FROM sqlite_master WHERE name='atendimentos'").get(), schema)
      assert.deepEqual(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => row.version), [1, 2])
      assert.equal(new CommercialRepository(db).catalogs().items.length, 163)
      db.close()
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('migration failure rolls back all V2 changes and preserves existing data/history; gaps and foreign databases refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'funix-migration-')), file = join(dir, 'v1.sqlite')
  try {
    let db = new DatabaseSync(file)
    db.exec(readFileSync(new URL('./fixtures/m1_1_schema.sql', import.meta.url), 'utf8'))
    const row = new AtendimentoRepository(db).create({ phone: '456' })
    db.exec('CREATE TABLE diagnosis_items (sentinel TEXT); INSERT INTO diagnosis_items VALUES (\'untouched\')')
    db.close()
    assert.throws(() => openDatabase(file), /already exists/)
    db = new DatabaseSync(file)
    assert.deepEqual(new AtendimentoRepository(db).get(row.id), row)
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='catalog_items'").get(), undefined)
    assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()!.version, 1)
    assert.equal(db.prepare('SELECT sentinel FROM diagnosis_items').get()!.sentinel, 'untouched')
    db.exec('DELETE FROM schema_migrations'); db.close()
    assert.throws(() => openDatabase(file), /inconsistente/)
    db = new DatabaseSync(file); db.exec('DROP TABLE schema_migrations'); db.close()
    assert.throws(() => openDatabase(file), /não pertence/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('V2 is byte-identical to supplied original; 163 physical proposals, no automatic validation and no missing-code identities', () => {
  const { db, repo } = setup()
  try {
    const hash = (url: URL) => createHash('sha256').update(readFileSync(url)).digest('hex')
    assert.equal(hash(new URL('../data/hierarquia-v2.json', import.meta.url)), hash(new URL('../../docs/especificacao-v1.0/originais/hierarquia_pecas_funix_v2.json', import.meta.url)))
    const items = repo.catalogs().items
    assert.equal(items.length, 163)
    assert.equal(hierarchyPieces().length, 163)
    assert(items.every(item => item.status === 'proposta' && item.code && item.kind === 'peca'))
    assert(items.some(item => item.suggestion))
    let missing = 0, both = 0
    const ids = new Set<string>()
    function walk(node: typeof hierarchy.acesso_geral) {
      if (node.id) { assert(!ids.has(node.id)); ids.add(node.id) }
      if (node.itens) { assert(node.itens.length <= 8); node.itens.forEach(walk) }
      if (node.tipo === 'peca' && !node.codigo_peca) missing++
      if (node.tipo === 'acao_ambos') { both++; assert.equal(node.gera_codigos_peca?.length, 2); assert(node.gera_codigos_peca?.every(code => items.some(item => item.code === code))) }
    }
    Object.values(hierarchy.regioes).forEach(walk); walk(hierarchy.acesso_geral)
    assert.equal(missing, 23); assert.equal(both, 123)
  } finally { db.close() }
})

test('catalog edits have revisions/history, immutable codes, own metadata only and explicit validation', () => {
  const { db, repo } = setup()
  try {
    const original = repo.catalogs().items[0]!
    const updated = repo.saveCatalog({ revision: 1, name: 'Nome sintético', status: 'validado' }, original.id)
    assert.equal(updated.revision, 2)
    assert.equal(updated.code, original.code)
    assert.equal(updated.source, 'hierarquia-v2')
    assert.equal(repo.historyOf(updated.id).length, 2)
    assert.throws(() => repo.saveCatalog({ revision: 1, name: 'Stale' }, updated.id), conflict)
    assert.throws(() => repo.saveCatalog({ revision: 2, code: 'invented' }, updated.id), invalid)
    assert.throws(() => repo.saveCatalog({ kind: 'peca', code: original.code, name: 'Duplicada' }), conflict)
    for (const value of [{ kind: 'peca', name: 'Sem código' }, { kind: 'servico', name: '' }, { kind: 'servico', name: 'Nome', price: 10 }, { kind: 'etapa', name: 'Não autorizada' }, { kind: 'dimensao', name: 'Dimensão sem serviço' }, { kind: 'servico', name: 'Nome', code: 'inadequado' }]) assert.throws(() => repo.saveCatalog(value), invalid)
    const service = repo.saveCatalog({ kind: 'servico', name: 'Serviço da direção' })
    assert.equal(service.status, 'proposta')
    assert.throws(() => repo.saveCatalog({ kind: 'dimensao', name: 'Nome', serviceId: service.id }), invalid)
  } finally { db.close() }
})

test('Ambos inserts two validated physical pieces atomically and repeated views deduplicate', () => {
  const { db, repo, atendimento, validate } = setup()
  try {
    const codes = ['para_lama_dianteiro__motorista', 'para_lama_dianteiro__passageiro']
    assert.throws(() => repo.add(atendimento.id, { pieceCodes: codes }), invalid)
    validate(codes[0]!)
    assert.throws(() => repo.add(atendimento.id, { pieceCodes: codes }), invalid)
    assert.equal(repo.list(atendimento.id).length, 0)
    validate(codes[1]!)
    const rows = repo.add(atendimento.id, { pieceCodes: codes })
    assert.equal(rows.length, 2)
    assert.equal(repo.add(atendimento.id, { pieceCodes: codes }).length, 2)
    assert.deepEqual(repo.add(atendimento.id, { pieceCodes: [codes[0]] }), rows)
    assert.throws(() => repo.add(atendimento.id, { pieceCodes: [''] }), invalid)
    assert.throws(() => repo.add(atendimento.id, { pieceCodes: ['Ambos'] }), invalid)
    assert.throws(() => repo.add(atendimento.id, { pieceCodes: codes.concat('capo') }), invalid)
  } finally { db.close() }
})

test('diagnosis composition validates references/quantities, preserves draft on errors/conflicts and removes children', () => {
  const { db, repo, atendimento, validate, service } = setup()
  try {
    validate('capo')
    const row = repo.add(atendimento.id, { pieceCodes: ['capo'] })[0]!
    const damage = repo.saveCatalog({ kind: 'diagnostico', name: 'Dano sintético', status: 'validado' })
    const s = service(), other = service()
    const dimension = repo.saveCatalog({ kind: 'dimensao', name: 'Dimensão sintética', serviceId: s.id, status: 'validado' })
    assert.throws(() => repo.updateDiagnosis(atendimento.id, row.id, { revision: 1, services: [{ serviceId: other.id, dimensionId: dimension.id, quantity: '1' }] }), invalid)
    for (const quantity of [0, -1, 1.5, '0', '-1', 'NaN', '1e3', '1.0000001', '1000000000', '0.000000', '1.2.3']) assert.throws(() => repo.updateDiagnosis(atendimento.id, row.id, { revision: 1, services: [{ serviceId: s.id, quantity }] }), invalid)
    assert.throws(() => repo.updateDiagnosis(atendimento.id, row.id, { revision: 1, diagnosisId: s.id }), invalid)
    const updated = repo.updateDiagnosis(atendimento.id, row.id, { revision: 1, diagnosisId: damage.id, notes: 'Rascunho sem preço', enabled: false, services: [{ serviceId: s.id, dimensionId: dimension.id, quantity: '2', enabled: true }] })
    assert.equal(updated.services.length, 1)
    assert.equal(updated.services[0]!.quantity, '2')
    assert.equal(updated.enabled, false)
    assert.equal(updated.revision, 2)
    assert.throws(() => repo.updateDiagnosis(atendimento.id, row.id, { revision: 1, notes: 'Stale' }), conflict)
    assert.throws(() => repo.remove(atendimento.id, row.id, { revision: 1 }), conflict)
    assert.deepEqual(repo.list(atendimento.id)[0], updated)
    const second = new AtendimentoRepository(db).create({ phone: '456' })
    assert.throws(() => repo.updateDiagnosis(second.id, row.id, { revision: 2, notes: 'Wrong parent' }), error => error instanceof ServiceError && error.status === 404)
    assert.throws(() => repo.updateDiagnosis(atendimento.id, row.id, { revision: 2, services: [{ id: 'foreign', serviceId: s.id, quantity: '1' }] }), invalid)
    repo.saveCatalog({ revision: s.revision, active: false }, s.id)
    repo.saveCatalog({ revision: damage.revision, active: false }, damage.id)
    // Deactivation is reversible; historical links do not vanish and remain removable.
    const revised = repo.updateDiagnosis(atendimento.id, row.id, { revision: 2, notes: 'Mantém vínculos anteriores', services: updated.services })
    assert.equal(revised.services[0]!.id, updated.services[0]!.id)
    repo.remove(atendimento.id, row.id, { revision: revised.revision })
    assert.equal(repo.list(atendimento.id).length, 0)
    assert.equal(db.prepare('SELECT count(*) AS n FROM diagnosis_services').get()!.n, 0)
    assert.equal(new AtendimentoRepository(db).get(atendimento.id).phone, '123')
  } finally { db.close() }
})

test('catalog and diagnosis survive file close/reopen including reference metadata and service edits', () => {
  const dir = mkdtempSync(join(tmpdir(), 'funix-commercial-')), file = join(dir, 'commercial.sqlite')
  try {
    let db = openDatabase(file), repo = new CommercialRepository(db)
    const at = new AtendimentoRepository(db).create({ phone: '123' })
    const piece = repo.catalogs().items.find(item => item.code === 'capo')!
    repo.saveCatalog({ revision: 1, status: 'validado' }, piece.id)
    const service = repo.saveCatalog({ kind: 'servico', name: 'Serviço sintético', status: 'validado' })
    const item = repo.add(at.id, { pieceCodes: ['capo'] })[0]!
    const saved = repo.updateDiagnosis(at.id, item.id, { revision: 1, services: [{ serviceId: service.id, quantity: '0.250000' }] })
    db.close(); db = openDatabase(file); repo = new CommercialRepository(db)
    assert.equal(saved.services[0]!.quantity, '0.25')
    assert.deepEqual(repo.list(at.id), [saved])
    assert.equal(repo.historyOf(piece.id).length, 2)
    const edited = repo.updateDiagnosis(at.id, item.id, { revision: 2, services: [] })
    assert.equal(edited.services.length, 0)
    db.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
