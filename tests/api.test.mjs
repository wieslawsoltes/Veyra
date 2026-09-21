import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// This asset can live anywhere. Point VEYRA_PROJECT_ROOT at the application checkout.
const root = resolve(process.env.VEYRA_PROJECT_ROOT || new URL('..', import.meta.url).pathname);
const { handleAPI, validateState } = await import(pathToFileURL(resolve(root, 'server/api.js')));
const migrations = readdirSync(resolve(root, 'drizzle')).filter(name => name.endsWith('.sql')).sort();
const migrationSQL = migrations.map(name => readFileSync(resolve(root, 'drizzle', name), 'utf8'));

class D1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.database, this.sql, values); }
  async first(column) {
    const row = this.database.prepare(this.sql).get(...this.values);
    return row ? column ? row[column] : { ...row } : null;
  }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values).map(row => ({ ...row })), success: true }; }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
}

class MemoryD1 {
  constructor() {
    this.database = new DatabaseSync(':memory:');
    this.database.exec('PRAGMA foreign_keys=ON');
    for (const sql of migrationSQL) this.database.exec(sql);
  }
  prepare(sql) { return new D1Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  close() { this.database.close(); }
}

class MemoryR2 {
  objects = new Map();
  async put(key, value, options = {}) { this.objects.set(key, { bytes: new Uint8Array(value).slice(), options }); }
  async get(key, options = {}) {
    const object = this.objects.get(key);
    if (!object) return null;
    const { offset = 0, length = object.bytes.length } = options.range || {};
    return { body: object.bytes.slice(offset, offset + length), size: object.bytes.length };
  }
  async delete(key) { this.objects.delete(key); }
}

const OWNER = { id: 'owner-1', email: 'owner@example.test' };
const REVIEWER = { id: 'reviewer-1', email: 'reviewer@example.test' };
const EDITOR = { id: 'editor-1', email: 'editor@example.test' };
const OUTSIDER = { id: 'outsider-1', email: 'outsider@example.test' };
const fixtureState = overrides => ({
  id: 'local-project', name: 'API test composition', width: 1920, height: 1080,
  fps: 24, duration: 120, assets: [], viewerNodeId: 'viewer',
  nodes: [
    { id: 'source', type: 'Constant', inputs: [], params: { color: '#abcdef' } },
    { id: 'viewer', type: 'Viewer', inputs: ['source'], params: {} },
  ], ...overrides,
});

function fixture(t) {
  const env = { DB: new MemoryD1(), BUCKET: new MemoryR2() };
  t.after(() => env.DB.close());
  async function request(path, { method = 'GET', who = OWNER, json, data, headers = {}, environment = env } = {}) {
    const h = new Headers(headers);
    if (who) {
      h.set('oai-authenticated-user-id', who.id);
      h.set('oai-authenticated-user-email', who.email);
    }
    if (json !== undefined) h.set('content-type', 'application/json');
    return handleAPI(new Request(`https://studio.example.test/api${path}`, {
      method, headers: h, body: json !== undefined ? JSON.stringify(json) : data,
    }), environment);
  }
  async function create(state = fixtureState()) {
    const response = await request('/projects', { method: 'POST', json: { state } });
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  }
  async function invite(projectId, role, who) {
    const response = await request(`/projects/${projectId}/invite`, { method: 'POST', json: { role } });
    assert.equal(response.status, 200);
    const invitation = await response.json();
    if (who) {
      const joined = await request('/join', { method: 'POST', who, json: { token: invitation.token } });
      assert.equal(joined.status, 200);
      assert.equal((await joined.json()).projectId, projectId);
    }
    return invitation;
  }
  return { env, request, create, invite };
}

test('authentication is required; only an explicit boolean development override bypasses it', async t => {
  const { env, request } = fixture(t);
  for (const path of ['/session', '/projects', '/assets/no-such-asset']) {
    assert.equal((await request(path, { who: null })).status, 401);
  }
  assert.equal((await request('/session', { who: null, environment: { ...env, LOCAL_DEVELOPMENT: 'true' } })).status, 401);
  const local = await request('/session', { who: null, environment: { ...env, LOCAL_DEVELOPMENT: true } });
  assert.equal(local.status, 200);
  assert.equal((await local.json()).user.id, 'local-studio-user');
});

test('creation commits an owner membership and initial version, with private project listing', async t => {
  const { request, create } = fixture(t);
  const project = await create();
  assert.equal(project.role, 'owner');
  assert.equal(project.revision, 1);
  assert.equal(project.state.id, project.id);
  const listed = await (await request('/projects')).json();
  assert.deepEqual(listed.projects.map(p => [p.id, p.role, p.revision]), [[project.id, 'owner', 1]]);
  const members = await (await request(`/projects/${project.id}/members`)).json();
  assert.deepEqual(members.members.map(m => [m.user_id, m.role]), [[OWNER.id, 'owner']]);
  const versions = await (await request(`/projects/${project.id}/versions`)).json();
  assert.equal(versions.versions.length, 1);
  assert.equal(versions.versions[0].label, 'Project created');
  assert.deepEqual((await (await request('/projects', { who: OUTSIDER })).json()).projects, []);
  assert.equal((await request(`/projects/${project.id}`, { who: OUTSIDER })).status, 404);
});

test('saved state persists between requests and stale revisions return the current document with 409', async t => {
  const { request, create } = fixture(t);
  const project = await create();
  const updated = { ...project.state, name: 'Saved composition', duration: 240 };
  const saved = await request(`/projects/${project.id}`, { method: 'PUT', json: { state: updated, revision: 1 } });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).revision, 2);
  const loaded = await (await request(`/projects/${project.id}`)).json();
  assert.deepEqual(loaded.state, updated);
  assert.equal(loaded.revision, 2);
  const stale = await request(`/projects/${project.id}`, { method: 'PUT', json: { state: project.state, revision: 1 } });
  assert.equal(stale.status, 409);
  const conflict = await stale.json();
  assert.equal(conflict.revision, 2);
  assert.deepEqual(conflict.state, updated);
  assert.deepEqual((await (await request(`/projects/${project.id}`)).json()).state, updated);
});

test('two writes at one base revision yield one success and one conflict', async t => {
  const { request, create } = fixture(t);
  const project = await create();
  const responses = await Promise.all(['A', 'B'].map(name => request(`/projects/${project.id}`, {
    method: 'PUT', json: { revision: 1, state: { ...project.state, name } },
  })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal((await (await request(`/projects/${project.id}`)).json()).revision, 2);
});

test('reviewers may read, comment, annotate, and resolve notes but may not save or snapshot', async t => {
  const { request, create, invite } = fixture(t);
  const project = await create();
  await invite(project.id, 'reviewer', REVIEWER);
  const read = await request(`/projects/${project.id}`, { who: REVIEWER });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).role, 'reviewer');
  assert.equal((await request(`/projects/${project.id}`, { method: 'PUT', who: REVIEWER, json: { state: project.state, revision: 1 } })).status, 403);
  assert.equal((await request(`/projects/${project.id}/versions`, { method: 'POST', who: REVIEWER, json: { label: 'blocked' } })).status, 403);
  const drawing = [{ x: 0.25, y: 0.5 }];
  const added = await request(`/projects/${project.id}/comments`, { method: 'POST', who: REVIEWER, json: { body: 'Warm the shadows', frame: 42, drawing } });
  assert.equal(added.status, 201);
  const { id } = await added.json();
  const notes = await (await request(`/projects/${project.id}/comments`)).json();
  assert.equal(notes.comments[0].author_id, REVIEWER.id);
  assert.equal(notes.comments[0].frame, 42);
  assert.deepEqual(JSON.parse(notes.comments[0].drawing), drawing);
  assert.equal((await request(`/projects/${project.id}/comments/${id}`, { method: 'PATCH', who: REVIEWER, json: { resolved: true } })).status, 200);
  assert.equal((await (await request(`/projects/${project.id}/comments`)).json()).comments[0].resolved, 1);
});

test('an editor can save but only the owner may create invites or manage roles', async t => {
  const { request, create, invite } = fixture(t);
  const project = await create();
  await invite(project.id, 'editor', EDITOR);
  await invite(project.id, 'reviewer', REVIEWER);
  assert.equal((await request(`/projects/${project.id}`, { method: 'PUT', who: EDITOR, json: { state: project.state, revision: 1 } })).status, 200);
  assert.equal((await request(`/projects/${project.id}/invite`, { method: 'POST', who: EDITOR, json: { role: 'editor' } })).status, 403);
  assert.equal((await request(`/projects/${project.id}/members/${REVIEWER.id}`, { method: 'PATCH', who: EDITOR, json: { role: 'editor' } })).status, 403);
  assert.equal((await request(`/projects/${project.id}/members/${REVIEWER.id}`, { method: 'PATCH', json: { role: 'editor' } })).status, 200);
  assert.equal((await (await request(`/projects/${project.id}`, { who: REVIEWER })).json()).role, 'editor');
  assert.equal((await request(`/projects/${project.id}/members/${OWNER.id}`, { method: 'PATCH', json: { role: 'reviewer' } })).status, 200);
  assert.equal((await (await request(`/projects/${project.id}`)).json()).role, 'owner');
  assert.equal((await request(`/projects/${project.id}/members/${REVIEWER.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request(`/projects/${project.id}`, { who: REVIEWER })).status, 404);
});

test('invites store only hashes, expire after seven days, and revocation prevents new joins', async t => {
  const { env, request, create, invite } = fixture(t);
  const project = await create();
  const issued = await invite(project.id, 'reviewer');
  const record = env.DB.database.prepare('SELECT * FROM invites').get();
  assert.notEqual(record.token_hash, issued.token);
  assert.match(record.token_hash, /^[a-f0-9]{64}$/);
  assert.equal(record.role, 'reviewer');
  assert.ok(Math.abs(record.expires_at - Date.now() - 7 * 86_400_000) < 5_000);
  env.DB.database.prepare('UPDATE invites SET expires_at=?').run(Date.now() - 1);
  assert.equal((await request('/join', { method: 'POST', who: REVIEWER, json: { token: issued.token } })).status, 404);
  const active = await invite(project.id, 'editor');
  assert.equal((await request(`/projects/${project.id}/invite`, { method: 'DELETE' })).status, 200);
  assert.equal((await request('/join', { method: 'POST', who: EDITOR, json: { token: active.token } })).status, 404);
});

test('joining a different invitation does not overwrite an existing membership role', async t => {
  const { request, create, invite } = fixture(t);
  const project = await create();
  const reviewerInvite = await invite(project.id, 'reviewer', REVIEWER);
  const editorInvite = await invite(project.id, 'editor');
  await request('/join', { method: 'POST', who: REVIEWER, json: { token: editorInvite.token } });
  assert.equal((await (await request(`/projects/${project.id}`, { who: REVIEWER })).json()).role, 'reviewer');
  await request('/join', { method: 'POST', json: { token: reviewerInvite.token } });
  assert.equal((await (await request(`/projects/${project.id}`)).json()).role, 'owner');
});

test('assets require editor access, persist bytes, and remain inaccessible to outsiders', async t => {
  const { env, request, create, invite } = fixture(t);
  const project = await create();
  await invite(project.id, 'reviewer', REVIEWER);
  await invite(project.id, 'editor', EDITOR);
  const upload = who => request(`/projects/${project.id}/assets`, { method: 'POST', who, data: new Uint8Array([10, 20, 30, 40, 50, 60]), headers: { 'content-type': 'video/mp4', 'x-file-name': encodeURIComponent('Clip 01.mp4') } });
  assert.equal((await upload(REVIEWER)).status, 403);
  assert.equal((await upload(OUTSIDER)).status, 404);
  const saved = await upload(EDITOR);
  assert.equal(saved.status, 201);
  const asset = await saved.json();
  assert.equal(asset.name, 'Clip 01.mp4');
  assert.equal(asset.size, 6);
  assert.equal(asset.mime, 'video/mp4');
  assert.equal(env.BUCKET.objects.size, 1);
  const media = await request(asset.url.replace('/api', ''), { who: REVIEWER });
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('content-type'), 'video/mp4');
  assert.equal(media.headers.get('content-length'), '6');
  assert.deepEqual([...new Uint8Array(await media.arrayBuffer())], [10, 20, 30, 40, 50, 60]);
  assert.equal((await request(`/assets/${asset.id}`, { who: OUTSIDER })).status, 404);
});

test('media range reads return exact bytes and clamp an end beyond file length', async t => {
  const { request, create } = fixture(t);
  const project = await create();
  const upload = await request(`/projects/${project.id}/assets`, { method: 'POST', data: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), headers: { 'content-type': 'video/webm' } });
  const asset = await upload.json();
  for (const [range, expected, contentRange] of [
    ['bytes=2-5', [2, 3, 4, 5], 'bytes 2-5/10'],
    ['bytes=7-', [7, 8, 9], 'bytes 7-9/10'],
    ['bytes=8-999', [8, 9], 'bytes 8-9/10'],
  ]) {
    const response = await request(`/assets/${asset.id}`, { headers: { range } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), contentRange);
    assert.equal(response.headers.get('content-length'), String(expected.length));
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], expected);
  }
  for (const range of ['bytes=10-', 'bytes=5-2']) {
    const response = await request(`/assets/${asset.id}`, { headers: { range } });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), 'bytes */10');
  }
});

test('unsupported active content is rejected before it reaches object storage', async t => {
  const { env, request, create } = fixture(t);
  const project = await create();
  for (const mime of ['text/html', 'image/svg+xml', 'application/javascript']) {
    const response = await request(`/projects/${project.id}/assets`, { method: 'POST', data: '<script>alert(1)</script>', headers: { 'content-type': mime } });
    assert.equal(response.status, 415);
  }
  assert.equal(env.BUCKET.objects.size, 0);
});

test('cross-origin mutation attempts are rejected before project state can change', async t => {
  const { request, create } = fixture(t);
  const project = await create();
  const hostile = { origin: 'https://attacker.example.test' };
  assert.equal((await request('/projects', { method: 'POST', headers: hostile, json: { state: fixtureState() } })).status, 403);
  assert.equal((await request(`/projects/${project.id}`, { method: 'PUT', headers: hostile, json: { state: project.state, revision: 1 } })).status, 403);
  assert.equal((await request(`/projects/${project.id}`, { method: 'DELETE', headers: hostile })).status, 403);
  assert.equal((await request(`/projects/${project.id}`, { method: 'PUT', headers: { origin: 'https://studio.example.test' }, json: { state: project.state, revision: 1 } })).status, 200);
});

test('cycles and missing input references are rejected without storing a project', async t => {
  const { request } = fixture(t);
  const invalidGraphs = [
    [{ id: 'self', type: 'Blur', inputs: ['self'] }],
    [{ id: 'a', type: 'Blur', inputs: ['b'] }, { id: 'b', type: 'Grade', inputs: ['a'] }],
    [{ id: 'a', type: 'Blur', inputs: ['missing'] }],
    [{ id: 'same', type: 'Constant', inputs: [] }, { id: 'same', type: 'Viewer', inputs: [] }],
  ];
  for (const nodes of invalidGraphs) {
    const response = await request('/projects', { method: 'POST', json: { state: fixtureState({ nodes, viewerNodeId: nodes[0].id }) } });
    assert.equal(response.status, 400, await response.clone().text());
  }
  assert.deepEqual((await (await request('/projects')).json()).projects, []);
});

test('valid branching graphs and disconnected nodes are accepted', () => {
  const state = fixtureState({ nodes: [
    { id: 'source', type: 'Constant', inputs: [] },
    { id: 'a', type: 'Grade', inputs: ['source'] },
    { id: 'b', type: 'Blur', inputs: ['source'] },
    { id: 'merge', type: 'Merge', inputs: ['a', 'b'] },
    { id: 'disconnected', type: 'Noise', inputs: [] },
    { id: 'viewer', type: 'Viewer', inputs: ['merge'] },
  ] });
  assert.deepEqual(JSON.parse(validateState(state)), state);
});

test('owner deletion removes project rows and media; editor deletion is forbidden', async t => {
  const { env, request, create, invite } = fixture(t);
  const project = await create();
  await invite(project.id, 'editor', EDITOR);
  await request(`/projects/${project.id}/assets`, { method: 'POST', data: new Uint8Array([1, 2]), headers: { 'content-type': 'image/png' } });
  await request(`/projects/${project.id}/comments`, { method: 'POST', json: { frame: 0, body: 'Delete me' } });
  await request(`/projects/${project.id}/presence`, { method: 'POST', json: { frame: 3 } });
  assert.equal((await request(`/projects/${project.id}`, { method: 'DELETE', who: EDITOR })).status, 403);
  assert.equal((await request(`/projects/${project.id}`, { method: 'DELETE' })).status, 200);
  for (const table of ['projects', 'members', 'versions', 'assets', 'comments', 'presence', 'invites']) {
    assert.equal(env.DB.database.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, `${table} should cascade delete`);
  }
  assert.equal(env.BUCKET.objects.size, 0);
});

test('request validation rejects malformed JSON, invalid dimensions, and missing revisions', async t => {
  const { request, create } = fixture(t);
  assert.equal((await request('/projects', { method: 'POST', data: '{bad', headers: { 'content-type': 'application/json' } })).status, 400);
  for (const state of [fixtureState({ width: 0 }), fixtureState({ height: 4097 }), fixtureState({ fps: 0 }), fixtureState({ duration: 1.5 })]) {
    assert.equal((await request('/projects', { method: 'POST', json: { state } })).status, 400);
  }
  const project = await create();
  assert.equal((await request(`/projects/${project.id}`, { method: 'PUT', json: { state: project.state } })).status, 400);
});

// Regression checks below intentionally fail until the corresponding API bugs are fixed.
test('REGRESSION: upload quota counts actual bytes even when content-length is omitted', async t => {
  const { env, request, create } = fixture(t);
  const project = await create();
  env.DB.database.prepare('INSERT INTO assets(id,project_id,name,mime,size,object_key,created_at) VALUES(?,?,?,?,?,?,?)')
    .run('quota-fixture', project.id, 'Existing media', 'video/mp4', 1024 * 1024 * 1024 - 3, 'existing-object', Date.now());
  const response = await request(`/projects/${project.id}/assets`, { method: 'POST', data: new Uint8Array([1, 2, 3, 4]), headers: { 'content-type': 'image/png' } });
  assert.equal(response.status, 413, 'The fourth byte exceeds the project media quota');
  assert.equal(env.BUCKET.objects.size, 0, 'No object should be written after quota rejection');
});

test('REGRESSION: null graph nodes and null assets are a 400 validation failure', async t => {
  const { request } = fixture(t);
  for (const [name, state] of [['null node', fixtureState({ nodes: [null] })], ['null asset', fixtureState({ assets: [null] })]]) {
    await t.test(name, async () => {
      const response = await request('/projects', { method: 'POST', json: { state } });
      assert.equal(response.status, 400, 'Malformed user data must not appear as a storage outage');
    });
  }
});

test('REGRESSION: invalid invite roles do not silently grant editor access', async t => {
  const { env, request, create } = fixture(t);
  const project = await create();
  const response = await request(`/projects/${project.id}/invite`, { method: 'POST', json: { role: 'reviever' } });
  assert.equal(response.status, 400, 'A typo in a reviewer role must not create an editor invite');
  assert.equal(env.DB.database.prepare('SELECT count(*) AS n FROM invites').get().n, 0);
});

test('REGRESSION: concurrent asset uploads cannot exceed the 200-file project limit', async t => {
  const { env, request, create } = fixture(t);
  const project = await create();
  const insert = env.DB.database.prepare('INSERT INTO assets(id,project_id,name,mime,size,object_key,created_at) VALUES(?,?,?,?,?,?,?)');
  for (let index = 0; index < 199; index++) {
    insert.run(`existing-${index}`, project.id, 'Existing media', 'image/png', 1, `existing-${index}`, Date.now());
  }
  const responses = await Promise.all([0, 1].map(() => request(`/projects/${project.id}/assets`, {
    method: 'POST', data: new Uint8Array([1]), headers: { 'content-type': 'image/png' },
  })));
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 413]);
  assert.equal(env.DB.database.prepare('SELECT count(*) AS n FROM assets WHERE project_id=?').get(project.id).n, 200);
  assert.equal(env.BUCKET.objects.size, 1);
});
