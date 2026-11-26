export type StockKind = 'supply' | 'paint'
export type StockMovementType = 'entry' | 'exit' | 'adjustment'

export type StockMaterial = {
  id: string
  kind: StockKind
  code: string
  name: string
  manufacturer: string
  unit: string
  minimum: string
  unitCost: string
  released: boolean
  revision: number
  balance: string
  stockValue: string
  reorder: boolean
}

export type StockMovement = {
  id: string
  materialId: string
  materialCode: string
  materialName: string
  materialKind: StockKind
  unit: string
  date: string
  recordedAt: string
  partner: string
  operator: string
  type: StockMovementType
  reason: string
  quantity: string
  unitCost: string
  total: string
}
