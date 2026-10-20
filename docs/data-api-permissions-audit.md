# Data API permissions audit

Audited October 20, 2026 against GitHub main `238df6c`. The [Supabase change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically) removes automatic grants for future public tables on existing projects on October 30. Existing tables keep their grants. Table grants and RLS are independent requirements.

## Creation paths and findings

OB1 is a collection of SQL Editor setup steps and optional schema scripts. GitHub main has no tracked `supabase/config.toml` or `supabase/migrations/` directory. The homelab `supabase-migrate` wrapper runs `supabase db push` from an ignored local Supabase directory. That directory has no migration files. The live migration ledger contains historical entries, but those SQL bodies are not preserved as local migration files. Therefore `db push` or `db reset` from this checkout cannot reproduce the installed project. No migration history was invented or imported by this patch.

New SQL Editor installations, preview projects, and recreation using the affected scripts would fail without explicit grants. A reset that only replays an empty local migration directory also lacks the schema itself, independently of the permissions change. If a deployment maintains migrations elsewhere, copy the reviewed grants into the corresponding table-creation migrations and test that full chain before resetting anything.

| Creation path | Required Data API access and result |
| --- | --- |
| `docs/01-getting-started.md` | Core `thoughts` already grants CRUD to `service_role`. Search and upsert use invoker functions and depend on that table grant. No new public grant needed. |
| `extensions/household-knowledge/schema.sql` | MCP uses service-role SELECT/INSERT on `household_items`, `household_vendors`. Added those grants. |
| `extensions/home-maintenance/schema.sql` | Service-role SELECT/INSERT on `maintenance_tasks`, `maintenance_logs`; the log trigger also updates tasks. Added UPDATE only on tasks. |
| `extensions/family-calendar/schema.sql` | Service-role SELECT/INSERT on `family_members`, `activities`, `important_dates`. Added grants and RLS with no client policies. The old script had no RLS. |
| `extensions/meal-planning/schema.sql` | Service-role SELECT/INSERT on `recipes`, `meal_plans`, `shopping_lists`; UPDATE on recipes and shopping lists. Added these grants. Shared-server role provisioning remains unresolved, below. |
| `extensions/professional-crm/schema.sql` | Service-role SELECT/INSERT on `professional_contacts`, `contact_interactions`, `opportunities`; UPDATE on contacts. Core thoughts already has SELECT. Added extension grants. |
| `extensions/job-hunt/schema.sql` | Service-role SELECT/INSERT on `companies`, `job_postings`, `applications`, `interviews`, `job_contacts`; UPDATE on interviews and job contacts. CRM linking also needs professional-crm installed. Added extension grants. |
| `schemas/readwise-books/schema.sql` | Capture/import clients use service-role SELECT/INSERT/UPDATE on `readwise_books`; the count RPC also updates it. Added those grants, RLS, and revoked public/anon/authenticated table access. No DELETE needed. |
| `recipes/adaptive-capture-classification/schema.sql` | Four tables already grant SELECT/INSERT/UPDATE to authenticated. `capture-with-gating.ts` uses service_role, which had no explicit grants. Added the same operations for that backend. |
| `schemas/agent-memory`, `schemas/per-agent-identity`, `schemas/crm-person-tiers`, `schemas/entity-extraction`, `schemas/thought-work-claims`, `schemas/typed-reasoning-edges`, `schemas/wiki-pages` | Table-creation SQL already includes explicit service-role table grants. Entity extraction also grants authenticated SELECT. No October 30 grant addition needed. |
| `schemas/smart-ingest` | Explicit service-role table and sequence grants already exist. Authenticated SELECT policies exist but no SELECT grant; those policies alone do not expose a client API on fresh installs. No new client grant added without a concrete caller. |
| `schemas/thought-audit` | Explicit service-role SELECT/INSERT already exists. Preserve the append-only intent. |
| `recipes/chatgpt-conversation-import`, `recipes/life-engine`, `recipes/ob-graph`, `recipes/repo-learning-coach`, `recipes/work-operating-model-activation`, `recipes/world-model-diagnostic-activation/schema-v2-draft.sql` | Table-creation SQL already includes service-role grants. The world-model file is a draft, not an installed baseline. |
| `recipes/schema-aware-routing/README.md`, `docs/drafts/agent-memory-staging-base.sql`, `recipes/local-brain-no-mcp/volumes/db/init/01-thoughts-schema.sh` | Explicit service-role table grants already exist in these alternate setup examples. |
| `integrations/kubernetes-deployment/k8s/init.sql`, `recipes/vercel-neon-telegram/sql/001-create-thoughts.sql` | Standalone PostgreSQL / Neon direct-connection paths. Supabase's managed Data API default change does not apply. |
| Remaining schema SQL files | Alter existing tables or define functions/views/indexes rather than create application tables. They retain their prerequisite tables' privileges. This does not certify all existing RPCs or views as safe for public exposure. |

The six extension MCP clients use `SUPABASE_SERVICE_ROLE_KEY` in their `index.ts` files. Readwise callers are `integrations/readwise-capture/index.ts` and `recipes/readwise-import/import-readwise.py`. The new grants follow those clients' current operations. No new anonymous or authenticated table grants, schema-wide grants, default grants, or SECURITY DEFINER workarounds are introduced. Extension scripts revoke PUBLIC/anon table access explicitly. Existing authenticated owner policies are preserved.

## Existing grants and RLS

Read-only inspection of the linked project on October 20 found 23 public application tables and one identity sequence. All 23 tables have RLS enabled. The 18 extension tables and `thoughts` retain legacy grants to anon, authenticated, and service_role. The three wiki tables and `thought_work_claims` have service-role table grants only. No customer rows were queried.

Extension policies in this installation check `auth.uid() = user_id`, including both USING and WITH CHECK. Core thoughts has a service-role policy. Wiki and work-claims tables deny client access without policies. Core search/upsert and the inspected wiki RPCs are SECURITY INVOKER, so their execute privileges do not bypass the underlying table/RLS boundary. Installed defaults still grant future objects broadly today. Nothing in this audit changed them.

The live project does not contain the optional Readwise/adaptive tables. Those findings come from repository SQL and caller inspection, plus isolated execution, not live installation evidence. Live migration history has 14 entries; local reset parity remains unverified because their SQL files are absent.

## Limits and separate authorization issues

- Family-calendar's creation script previously omitted RLS even though the installed project has a later RLS repair. The patch makes fresh creation deny client access while keeping the service-role MCP functional.
- The meal-planning shared-server guide confuses an app metadata claim with a PostgreSQL role and describes a limited service account without provisioning one. There is no justified `household_member` grant to add. This patch does not certify that shared-server setup; it validates the primary service-role MCP path.
- Adaptive capture's authenticated policies check only the authenticated role, despite names saying "their own". They have no ownership column and permit shared authenticated access. The existing grant/policy is preserved, not expanded. Multi-user ownership requires a separate design change.
- Entity extraction's authenticated SELECT policies are deliberately permissive scaffolding. Smart-ingest's user SELECT policies require a separate explicit grant if a client is later introduced. Neither is a reason to copy broad public grants.
- Some older RPC definitions grant EXECUTE publicly. Table grants and RLS still matter for invoker functions. A full RPC/view security audit is outside this permissions compatibility patch.
- Grants are additive for existing service-role objects. This patch does not remove historical service-role privileges, such as DELETE/TRUNCATE inherited when objects were created. Fresh installs get only the stated operations. Readwise's new RLS and revokes intentionally close direct client table access; deployments with custom browser clients must review that change.

## Reproduce validation

Prerequisites: Node.js 22 or newer, Docker, and permission to pull `pgvector/pgvector:pg17` and `postgrest/postgrest:v12.2.12`. No Supabase CLI, project secrets, live database URL, or cloud project is used. The script creates uniquely named disposable containers and a Docker network, binds HTTP only to loopback, and removes its own resources in a finally block. The auth helper functions model Supabase's JWT claims; this is PostgreSQL/PostgREST validation, not a full GoTrue, GraphQL, or Supabase CLI reset test.

```bash
node scripts/test-data-api-permissions.mjs
node scripts/test-data-api-permissions.mjs --legacy-defaults
```

Each invocation creates a fresh database and replays the actual core setup SQL, six extension schemas, Readwise schema, and adaptive capture schema. Readwise's documented prerequisite `thoughts.source_type` is supplied explicitly; the full enhanced-thoughts feature is outside this fixture. Fresh mode has no automatic table/sequence grants. Legacy mode starts with Supabase-style broad table defaults to verify anonymous denial and existing authenticated owner isolation after the patch.

Checks cover all 24 tables in this test scope: service-role reads over HTTP, exact required/missing privileges on fresh tables, RLS enabled, anonymous/client denial, real calendar INSERT, Readwise INSERT/upsert/count RPC, adaptive backend upsert, and cross-user RLS isolation under legacy defaults. Every invocation rebuilds from scratch, so repeating the command tests recreation without relying on a previous database. Other optional schemas above were inspected statically, not replayed by this test.

For a regression comparison against the fetched pre-patch main:

```bash
node scripts/test-data-api-permissions.mjs --baseline
```

Expected failure: `service_role SELECT household_items`, HTTP 403 / SQLSTATE 42501, `permission denied for table household_items`. The normal patched run must pass. CI runs fresh and legacy modes on relevant pull requests.

For a read-only catalog refresh of an explicitly selected database:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/audit-data-api-permissions.sql
```

Do not run `supabase db reset` on the current local checkout as a claimed rebuild test: there are no tracked migration files to replay. Once a full migration chain is restored, use `supabase db reset --local` only against a disposable local project, then repeat role/API checks there. Do not run `db push` or deploy these SQL files against the linked project until the owner approves the reviewed SQL.

This audit used the Supabase [permissions changelog](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically) and [API security guidance](https://supabase.com/docs/guides/api/securing-your-api). Open Brain's original setup and community work come from [Nate B. Jones](https://natebjones.com) and [Nate's newsletter](https://substack.com/@natesnewsletter).

## Recorded results

On October 20, 2026, the pre-patch comparison failed at `household_items` with HTTP 403 / SQLSTATE 42501. The patched fresh run passed 245 checks across 24 tables; the legacy-default run passed 143 checks across the same 24 tables. Markdown lint and `git diff --check` passed. The CI workflow is included for reproduction; local results do not establish a completed GitHub Actions run. No live migration or permission changes were performed.
