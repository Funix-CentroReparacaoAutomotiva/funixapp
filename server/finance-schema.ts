import type {DatabaseSync} from 'node:sqlite'

export function createFinanceSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE financial_titles (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('receivable', 'payable')),
      counterparty TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 9007199254740991),
      due_date TEXT NOT NULL,
      experience_id TEXT REFERENCES production_experiences(id) ON DELETE RESTRICT
    ) STRICT;

    CREATE TABLE financial_settlements (
      id TEXT PRIMARY KEY NOT NULL,
      title_id TEXT NOT NULL REFERENCES financial_titles(id) ON DELETE RESTRICT,
      amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 9007199254740991),
      date TEXT NOT NULL,
      reversed_at TEXT
    ) STRICT;
    CREATE INDEX financial_settlements_title ON financial_settlements(title_id);
  `)
}
