import test from 'node:test'
import assert from 'node:assert/strict'
import { AUDITED_COLUMNS, CodaReadRepository, cellRowId, mapRow } from '../coda.ts'
import { ServiceError } from '../errors.ts'
import type { WorkspaceQuery } from '../../shared/contracts.ts'

test('maps rich REST and connector refs without selecting an ambiguous relationship', () => {
  assert.equal(cellRowId({ id: 'i-rest', name: 'Teste' }), 'i-rest')
  assert.equal(cellRowId({ rowId: 'i-connector', name: 'Teste' }), 'i-connector')
  assert.equal(cellRowId([{ id: 'i-a' }, { id: 'i-b' }]), null)
  const row = mapRow('experiencia', { id: 'i-test', browserLink: 'javascript:alert(1)', values: { id: 'XP-TEST', customer: { name: 'Dado sintético' }, car: { name: 'AAA0A00', id: 'i-vehicle' }, status: { name: 'Finalizado', id: 'i-finished' }, finished: true, departed: false, parent: [{ id: 'i-parent' }] } }, { 'xp_ID Experiencia': 'id', cliente_Entidade: 'customer', cliente_Veiculo: 'car', fase_Comercial: 'status', flag_Finalizada: 'finished', flag_Saiu: 'departed', Atendimento: 'parent' })
  assert.equal(row.id, 'XP-TEST')
  assert.equal(row.plate, 'AAA0A00')
  assert.equal(row.finished, true)
  assert.equal(row.departed, false)
  assert.equal(row.atendimentoRowId, 'i-parent')
  assert.equal(row.sourceUrl, '')
})

test('does not hide a missing, ambiguous, or unreadable Atendimento origin', () => {
  for (const parent of [[], [{ id: 'i-a' }, { id: 'i-b' }], { name: 'Display text without row ID' }]) {
    assert.throws(() => mapRow('experiencia', { id: 'i-test', values: { parent } }, { Atendimento: 'parent' }), (error: unknown) => error instanceof ServiceError && error.code === 'CODA_RELATION_CONFLICT')
  }
})

const query: WorkspaceQuery = { area: 'funil', scope: 'acompanhamento', q: 'sintetico', cursor: 'opaque+cursor', limit: 25 }
const columnNames = ['at_IdAtendimento', 'at_StatusComercial', 'funil_Nome', 'funil_Contato', 'funil_Modelo', 'funil_Placa']

test('reads fixed API using GET, preserves opaque pagination, projects safe DTO and filters the current page', async () => {
  const calls: { url: URL; init: RequestInit }[] = []
  const mock: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    calls.push({ url, init: init ?? {} })
    if (url.pathname.endsWith('/tables/grid-view-test')) return Response.json({ name: 'Viz. Atendimentos (PC)', tableType: 'view' })
    if (url.pathname.endsWith('/columns')) return Response.json({ items: columnNames.map(name => ({ id: AUDITED_COLUMNS['grid-eGvJhrlDTH']![name], name: 'Renamed column' })) })
    if (url.pathname.includes('grid-DXriGyd94a')) return Response.json({ items: ['i-WVc9SdOAzf', 'i-y-QXpAVKUp', 'i-JinLqTCLcw', 'i-v6QUAa-L50', 'i-9kGcgfN3eV', 'i-FtvoC1lZFj'].map((id, index) => ({ id, name: `Etapa teste ${index}`, values: { 'c-oFRnyLOfCl': index + 1 } })) })
    if (url.pathname.includes('/grid-eGvJhrlDTH/rows/i-')) {
      const id = url.pathname.split('/').at(-1)!
      return Response.json({ id, name: 'AT-TEST', browserLink: 'https://coda.io/d/test', values: { 'c-Zorfa5ARUf': 'AT-TEST', 'c-xUxJ99lkfc': { id: 'i-WVc9SdOAzf', name: 'Novo lead (30min)' }, 'c-hV24W_ZrDh': id === 'i-test' ? 'Contato sintético' : 'Outro exemplo', 'secret-content': 'never returned' } })
    }
    // The view deliberately omits every hidden DTO field.
    return Response.json({ items: [{ id: 'i-test', values: {} }, { id: 'i-other', values: {} }], nextPageToken: 'next==opaque' })
  }
  const repository = new CodaReadRepository({ token: 'synthetic-token', fetch: mock, views: { funil: 'grid-view-test', acompanhamento: 'grid-another', historico: '' } })
  const response = await repository.workspace(query)
  assert.equal(response.items.length, 1)
  assert.equal(response.items[0]?.rowId, 'i-test')
  assert.equal(response.items[0]?.stageId, 'i-WVc9SdOAzf')
  assert.equal(response.nextCursor, 'next==opaque')
  assert.equal(JSON.stringify(response).includes('never returned'), false)
  assert.equal(response.capabilities.write, false)
  for (const call of calls) {
    assert.equal(call.url.origin, 'https://coda.io')
    assert.equal(call.init.method, 'GET')
    assert.equal(call.init.redirect, 'error')
    assert.equal((call.init.headers as Record<string, string>).Authorization, 'Bearer synthetic-token')
  }
  const rows = calls.find(call => call.url.pathname.endsWith('/grid-view-test/rows'))!
  assert.equal(rows.url.searchParams.get('pageToken'), 'opaque+cursor')
  assert.equal(rows.url.searchParams.get('limit'), '25')
  assert.equal(rows.url.searchParams.get('visibleOnly'), 'true')
  assert.equal(calls.filter(call => /\/grid-eGvJhrlDTH\/rows\/i-/.test(call.url.pathname)).length, 2)
  const callCount = calls.length
  assert.equal((await repository.record('atendimento', 'i-test')).name, 'Contato sintético')
  assert.equal(calls.length, callCount, 'detail navigation reuses the 30-second minimal DTO cache')
})

test('no credential makes no network request; view configuration is mandatory', async () => {
  let called = false
  const mock: typeof fetch = async () => { called = true; return Response.json({}) }
  await assert.rejects(new CodaReadRepository({ fetch: mock }).workspace(query), (error: unknown) => error instanceof ServiceError && error.code === 'CODA_NOT_CONFIGURED')
  assert.equal(called, false)
  await assert.rejects(new CodaReadRepository({ token: 'test', fetch: mock }).workspace(query), (error: unknown) => error instanceof ServiceError && error.code === 'CODA_VIEW_NOT_VERIFIED')
  assert.equal(called, false)
})

test('upstream failure is sanitized and does not become successful empty data', async () => {
  const repository = new CodaReadRepository({ token: 'test', fetch: async () => new Response('sensitive upstream text', { status: 401 }), views: { funil: 'grid-view', acompanhamento: '', historico: '' } })
  await assert.rejects(repository.workspace(query), (error: unknown) => error instanceof ServiceError && error.status === 502 && !error.message.includes('sensitive'))
})

test('refuses a configured table that is not the audited view', async () => {
  const repository = new CodaReadRepository({ token: 'test', fetch: async () => Response.json({ name: 'Outra tabela', tableType: 'table' }), views: { funil: 'grid-wrong', acompanhamento: '', historico: '' } })
  await assert.rejects(repository.workspace(query), (error: unknown) => error instanceof ServiceError && error.code === 'CODA_VIEW_MISMATCH')
})
