import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../../docs/sql/evolution_catalog_readonly.sql', import.meta.url), 'utf8')
const withoutComments = source.split('\n').filter(line => !/^\s*--/.test(line)).join('\n')

test('Evolution catalog #76: SQL uses only bounded read-only transaction and catalog relations', () => {
  assert.match(withoutComments, /^\s*BEGIN TRANSACTION READ ONLY\s*;/i)
  assert.match(withoutComments, /SET LOCAL statement_timeout\s*=\s*'3000ms'\s*;/i)
  assert.match(withoutComments, /SET LOCAL lock_timeout\s*=\s*'500ms'\s*;/i)
  assert.match(withoutComments, /COMMIT\s*;\s*$/i)

  const statements = withoutComments.split(';').map(s => s.trim()).filter(Boolean)
  assert.equal(statements.length, 9)
  for (const [index, statement] of statements.entries()) {
    if (index === 0) assert.match(statement, /^BEGIN TRANSACTION READ ONLY$/i)
    else if (index <= 2) assert.match(statement, /^SET LOCAL (statement_timeout|lock_timeout)\s*=/i)
    else if (index === statements.length - 1) assert.match(statement, /^COMMIT$/i)
    else assert.match(statement, /^SELECT\b/i)
  }
  assert.doesNotMatch(withoutComments, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|COPY|VACUUM|ANALYZE|EXPLAIN|DO|CALL|EXECUTE|GRANT|REVOKE)\b/i)
  const relations = [...withoutComments.matchAll(/\b(?:FROM|JOIN)\s+([\w.]+)/gi)].map(m => m[1].toLowerCase())
  assert.deepEqual(new Set(relations), new Set([
    'information_schema.tables',
    'information_schema.columns',
    'pg_catalog.pg_indexes',
    'information_schema.table_constraints',
    'information_schema.key_column_usage',
  ]))
  for (const table of ['Message', 'Chat', 'MessageUpdate']) assert.ok(withoutComments.includes(`'${table}'`))
})
