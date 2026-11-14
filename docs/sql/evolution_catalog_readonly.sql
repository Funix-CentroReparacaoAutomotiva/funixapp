-- FUNIX / Issue #76
-- Catalog-only PostgreSQL 15 inspection. No business data rows.
-- Authorized administrative session only; never share credentials or customer data.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '3000ms';
SET LOCAL lock_timeout = '500ms';

SELECT current_setting('server_version') AS postgres_version;

SELECT table_schema, table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('Message', 'Chat', 'MessageUpdate')
ORDER BY table_name;

SELECT table_name, ordinal_position, column_name, data_type, udt_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('Message', 'Chat', 'MessageUpdate')
ORDER BY table_name, ordinal_position;

SELECT tablename AS table_name, indexname AS index_name, indexdef AS index_definition
FROM pg_catalog.pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('Message', 'Chat', 'MessageUpdate')
ORDER BY tablename, indexname;

SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
       kcu.ordinal_position, kcu.column_name
FROM information_schema.table_constraints AS tc
LEFT JOIN information_schema.key_column_usage AS kcu
  ON kcu.constraint_catalog = tc.constraint_catalog
 AND kcu.constraint_schema = tc.constraint_schema
 AND kcu.constraint_name = tc.constraint_name
 AND kcu.table_name = tc.table_name
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('Message', 'Chat', 'MessageUpdate')
  AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')
ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;
COMMIT;
