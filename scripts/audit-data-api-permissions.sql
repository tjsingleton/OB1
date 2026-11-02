-- Read-only catalog inspection. No customer rows or credentials are selected.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       r.role_name,
       has_table_privilege(r.role_name, c.oid, 'SELECT') AS can_select,
       has_table_privilege(r.role_name, c.oid, 'INSERT') AS can_insert,
       has_table_privilege(r.role_name, c.oid, 'UPDATE') AS can_update,
       has_table_privilege(r.role_name, c.oid, 'DELETE') AS can_delete
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) r(role_name)
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY c.relname, r.role_name;

SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public'
ORDER BY tablename, policyname;

SELECT defaclrole::regrole AS creator, defaclnamespace::regnamespace AS schema_name,
       defaclobjtype, defaclacl
FROM pg_default_acl WHERE defaclnamespace = 'public'::regnamespace;
