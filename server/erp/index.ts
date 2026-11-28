import type { DatabaseSync } from 'node:sqlite'
import { handleExperiences, migrateExperiences } from './experiences.ts'
import { handleFinance, migrateFinance } from './finance.ts'
import { handleSales, migrateSales } from './sales.ts'
import { handleStock, migrateStock } from './stock.ts'
import { handleTasks, migrateTasks } from './tasks.ts'
import { handleWorkshop, migrateWorkshop } from './workshop.ts'
import type { ErpRequest } from './contracts.ts'

export const erpHandlers = new Map<string, (request: ErpRequest) => unknown>([
  ['workshop', handleWorkshop],
  ['sales', handleSales],
  ['finance', handleFinance],
  ['stock', handleStock],
  ['tasks', handleTasks],
  ['experiences', handleExperiences],
])

export function migrateOperationalErp(db: DatabaseSync) {
  migrateWorkshop(db)
  migrateFinance(db)
  migrateExperiences(db)
  migrateSales(db)
  migrateStock(db)
  migrateTasks(db)
}
