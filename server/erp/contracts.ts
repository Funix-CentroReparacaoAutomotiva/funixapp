import type { DatabaseSync } from 'node:sqlite'

export type ErpRequest = {
  db: DatabaseSync
  method: 'GET' | 'POST'
  path: string
  query: URLSearchParams
  body: unknown
  now: () => number
}
