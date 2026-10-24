-- SQL extraído sem alterações da migração do commit auditado 3bf660e.

      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE atendimentos (
        id TEXT PRIMARY KEY,
        phone TEXT NOT NULL,
        phone_normalized TEXT,
        name TEXT NOT NULL DEFAULT '',
        vehicle TEXT NOT NULL DEFAULT '',
        brand TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        plate TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        search_text TEXT NOT NULL DEFAULT '',
        stage TEXT NOT NULL DEFAULT 'novo-lead'
          CHECK (stage IN ('novo-lead','aguardando-dados','em-negociacao','morno','frio','rejeitados')),
        rejection_reason TEXT NOT NULL DEFAULT '',
        explicit_refusal INTEGER NOT NULL DEFAULT 0 CHECK (explicit_refusal IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
        CHECK (stage != 'rejeitados' OR (explicit_refusal = 1 AND length(trim(rejection_reason)) > 0))
      );
      CREATE INDEX atendimentos_updated ON atendimentos(updated_at DESC, id);
      CREATE INDEX atendimentos_phone_normalized ON atendimentos(phone_normalized);

INSERT INTO schema_migrations VALUES (1, '2026-10-24T00:00:00.000Z');
