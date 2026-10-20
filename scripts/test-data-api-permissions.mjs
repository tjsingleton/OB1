// Isolated PostgreSQL/PostgREST integration test. Never accepts a database URL.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = process.argv.includes('--baseline');
const legacy = process.argv.includes('--legacy-defaults');
const name = `ob1-permissions-${process.pid}-${randomBytes(4).toString('hex')}`;
const secret = randomBytes(32).toString('hex');
const password = randomBytes(24).toString('hex');
const db = `${name}-db`, api = `${name}-api`;
const run = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { cwd: root, input, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
};
const docker = (...args) => run('docker', args);
const sql = (s) => run('docker', ['exec', '-i', db, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], s);
const source = (path) => baseline ? run('git', ['show', `origin/main:${path}`]) : readFileSync(`${root}${path}`, 'utf8');
const extensionFiles = ['household-knowledge', 'home-maintenance', 'family-calendar', 'meal-planning', 'professional-crm', 'job-hunt'].map(n => `extensions/${n}/schema.sql`);
const files = [...extensionFiles, 'schemas/readwise-books/schema.sql', 'recipes/adaptive-capture-classification/schema.sql'];
const tablesIn = (s) => [...s.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?(\w+)/gi)].map(m => m[1]);
const adaptiveTables = tablesIn(source(files.at(-1)));
const tables = ['thoughts', ...files.flatMap(f => tablesIn(source(f)))];
const jwt = (role, sub = '11111111-1111-4111-8111-111111111111') => {
  const b = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const body = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ role, sub, exp: Math.floor(Date.now()/1000)+3600 })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
try {
  docker('network', 'create', name);
  docker('run', '-d', '--name', db, '--network', name, '-e', `POSTGRES_PASSWORD=${password}`, 'pgvector/pgvector:pg17');
  for (let n = 0; ; n++) {
    try { docker('exec', db, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); sql('select 1;'); break; } catch (e) { if (n === 59) throw e; await sleep(500); }
  }
  sql(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE ROLE authenticator LOGIN PASSWORD '${password}' NOINHERIT;
    GRANT anon, authenticated, service_role TO authenticator;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (auth.jwt()->>'sub')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt()->>'role' $$;
    CREATE EXTENSION vector;`);
  // No implicit table/sequence grants: reproduce the October 30 role boundary.
  sql('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;');
  if (legacy) sql('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;');
  const core = [...source('docs/01-getting-started.md').matchAll(/```sql\n([\s\S]*?)```/g)].slice(0, 4).map(m => m[1]).join('\n');
  sql(core);
  // Readwise's documented enhanced-thoughts prerequisite: only the column it uses.
  sql('ALTER TABLE public.thoughts ADD COLUMN source_type text;');
  for (const f of files) sql(source(f));
  docker('run', '-d', '--name', api, '--network', name, '-p', '127.0.0.1::3000',
    '-e', `PGRST_DB_URI=postgres://authenticator:${password}@${db}:5432/postgres`,
    '-e', 'PGRST_DB_SCHEMAS=public', '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', `PGRST_JWT_SECRET=${secret}`,
    'postgrest/postgrest:v12.2.12');
  const port = docker('port', api, '3000/tcp').split(':').at(-1);
  const request = async (table, role, method = 'GET', body, query = '?select=*&limit=1', sub) => {
    const r = await fetch(`http://127.0.0.1:${port}/${table}${query}`, { method, signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${jwt(role, sub)}`, 'Content-Type': 'application/json', Prefer: ['readwise_books', 'capture_thresholds'].includes(table) ? 'return=representation,resolution=merge-duplicates' : 'return=representation' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.status === 204 ? null : await r.json() };
  };
  for (let n = 0; ; n++) {
    try { const ready = await request('thoughts', 'service_role'); if (ready.status !== 200) throw new Error(JSON.stringify(ready)); break; } catch (e) { if (n === 59) throw e; await sleep(500); }
  }
  for (const t of tables) {
    const r = await request(t, 'service_role');
    assert.equal(r.status, 200, `service_role SELECT ${t}: ${JSON.stringify(r)}`); checks++;
    const privileges = ['INSERT'];
    const needsUpdate = ['thoughts', 'readwise_books', 'maintenance_tasks', 'recipes', 'shopping_lists', 'professional_contacts', 'job_contacts', 'interviews', ...adaptiveTables];
    if (needsUpdate.includes(t)) privileges.push('UPDATE');
    if (t === 'thoughts') privileges.push('DELETE');
    for (const privilege of privileges) {
      assert.equal(sql(`select has_table_privilege('service_role', 'public.${t}', '${privilege}');`), 't', `${t} ${privilege}`); checks++;
    }
    if (!legacy) {
      for (const denied of ['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'].filter(p => !privileges.includes(p))) {
        assert.equal(sql(`select has_table_privilege('service_role', 'public.${t}', '${denied}');`), 'f', `${t} must not grant ${denied}`); checks++;
      }
    }
    const a = await request(t, 'anon');
    assert.ok(a.status === 401 || a.status === 403 || (legacy && a.status === 200 && a.body.length === 0), `anon denied ${t}: ${JSON.stringify(a)}`); checks++;
    assert.equal(sql(`select relrowsecurity from pg_class where oid='public.${t}'::regclass;`), 't', `${t} RLS`); checks++;
    if (!adaptiveTables.includes(t)) {
      const a = await request(t, 'authenticated');
      // thoughts has no user-facing grant on a fresh project either.
      assert.ok(a.status === 403 || (legacy && a.status === 200 && a.body.length === 0), `authenticated denied ${t}: ${JSON.stringify(a)}`); checks++;
    }
  }
  // Exercise real API writes, including upsert and invoker RPC, with synthetic data.
  let r = await request('family_members', 'service_role', 'POST', { user_id: '11111111-1111-4111-8111-111111111111', name: 'permission test' }, '');
  assert.equal(r.status, 201, JSON.stringify(r)); checks++;
  r = await request('readwise_books', 'service_role', 'POST', { book_id: 1, title: 'permission test' }, '');
  assert.equal(r.status, 201, JSON.stringify(r)); checks++;
  r = await request('readwise_books', 'service_role', 'POST', { book_id: 1, title: 'updated via upsert' }, '');
  assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.body[0].title, 'updated via upsert'); checks += 2;
  r = await request('rpc/increment_book_highlight_count', 'service_role', 'POST', { p_book_id: 1 }, '');
  assert.ok(r.status === 200 || r.status === 204, JSON.stringify(r)); checks++;
  r = await request('capture_thresholds', 'service_role', 'POST', { item_type: 'permission-test', threshold: 0.8 }, '');
  assert.equal(r.status, 201, JSON.stringify(r)); checks++;
  r = await request('capture_thresholds', 'service_role', 'POST', { item_type: 'permission-test', threshold: 0.9 }, '');
  assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(r.body[0].threshold, 0.9); checks += 2;
  // Preserve adaptive capture's existing authenticated access.
  r = await request('capture_thresholds', 'authenticated');
  assert.equal(r.status, 200, JSON.stringify(r)); checks++;
  if (legacy) {
    r = await request('household_items', 'service_role', 'POST', { user_id: '11111111-1111-4111-8111-111111111111', name: 'private item' }, '');
    assert.equal(r.status, 201, JSON.stringify(r)); checks++;
    r = await request('household_items', 'anon');
    assert.ok(r.status === 401 || r.status === 403, JSON.stringify(r)); checks++;
    r = await request('household_items', 'authenticated');
    assert.equal(r.body.length, 1, JSON.stringify(r)); checks++;
    r = await request('household_items', 'authenticated', 'GET', undefined, '?select=*', '22222222-2222-4222-8222-222222222222');
    assert.deepEqual(r.body, [], JSON.stringify(r)); checks++;
    r = await request('household_items', 'authenticated', 'POST', { user_id: '22222222-2222-4222-8222-222222222222', name: 'wrong owner' }, '');
    assert.equal(r.status, 403, JSON.stringify(r)); checks++;
  }
  console.log(`PASS: ${checks} checks across ${tables.length} tables; ${legacy ? 'legacy defaults' : 'fresh schema'} + PostgREST. No live project contacted.`);
} finally {
  for (const container of [api, db]) spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
  spawnSync('docker', ['network', 'rm', name], { stdio: 'ignore' });
}
