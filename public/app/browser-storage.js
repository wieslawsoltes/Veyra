/** IndexedDB storage adapter for static hosting. No authentication or network collaboration. */
import {importProject} from '../packages/core/index.js';

const clone = value => structuredClone(value);
const request = value => new Promise((resolve, reject) => {
  value.onsuccess = () => resolve(value.result);
  value.onerror = () => reject(value.error);
});
const error = (status, message, data = {}) => Object.assign(new Error(message), {status, data: {error: message, ...data}});
const clean = (value, length = 160) => String(value ?? '').trim().slice(0, length);
const MAX_MEDIA = 50 * 1024 * 1024;
const USER = Object.freeze({id: 'browser-local-artist', email: 'Browser-local artist'});

export class BrowserProjectStore {
  constructor({name = `veyra:${new URL('../', import.meta.url).pathname}`, indexedDB = globalThis.indexedDB,
    baseURL = new URL('../', import.meta.url), createObjectURL = blob => URL.createObjectURL(blob),
    revokeObjectURL = url => URL.revokeObjectURL(url)} = {}) {
    this.name = name;
    this.indexedDB = indexedDB;
    this.baseURL = new URL(baseURL);
    this.createObjectURL = createObjectURL;
    this.revokeObjectURL = revokeObjectURL;
    this.urls = new Map();
    this.connection = null;
  }

  async open() {
    if (!this.indexedDB) throw error(503, 'Browser storage is unavailable. Export a project backup before closing.');
    if (!this.connection) this.connection = new Promise((resolve, reject) => {
      const req = this.indexedDB.open(this.name, 1);
      req.onupgradeneeded = () => {
        for (const name of ['projects', 'media', 'versions', 'comments']) {
          if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, {keyPath: 'id'});
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); this.connection = null; };
        resolve(db);
      };
      req.onerror = () => { this.connection = null; reject(req.error); };
      req.onblocked = () => reject(error(503, 'Close other Veyra tabs to finish the browser storage upgrade.'));
    });
    return this.connection;
  }

  async transaction(names, mode, operation) {
    const db = await this.open();
    const tx = db.transaction(names, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('Browser storage transaction was aborted.'));
      tx.onerror = () => {}; // onabort reports the error after the transaction settles.
    });
    // Attach a handler immediately, including when a request rejects before the transaction.
    done.catch(() => {});
    const stores = Object.fromEntries(names.map(name => [name, tx.objectStore(name)]));
    try {
      const result = await operation(stores);
      await done;
      return result;
    } catch (cause) {
      try { tx.abort(); } catch {}
      await done.catch(() => {});
      if (cause.name === 'QuotaExceededError') throw error(507, 'Browser storage is full. Export backups and free space before saving again.');
      throw cause;
    }
  }

  async readProject(id) {
    const record = await this.transaction(['projects'], 'readonly', ({projects}) => request(projects.get(id)));
    if (!record) throw error(404, 'This project is not stored in this browser. Import its project file or open it on the original device.');
    return record;
  }

  objectURL(record) {
    if (!this.urls.has(record.id)) this.urls.set(record.id, this.createObjectURL(record.blob));
    return this.urls.get(record.id);
  }

  async hydrate(state) {
    const result = clone(state);
    const media = await this.transaction(['media'], 'readonly', ({media}) => Promise.all(result.assets.map(asset => request(media.get(asset.id)))));
    result.assets.forEach((asset, index) => {
      if (media[index]) asset.url = this.objectURL(media[index]);
      else if (asset.id === 'asset-neon-city' && asset.url.endsWith('/assets/neon-city.jpg')) {
        asset.url = new URL('assets/neon-city.jpg', this.baseURL).pathname;
      }
    });
    return result;
  }

  async canonical(state) {
    const result = importProject(state);
    const keys = new Set(await this.transaction(['media'], 'readonly', ({media}) => request(media.getAllKeys())));
    for (const asset of result.assets) {
      if (keys.has(asset.id)) asset.url = `./__local_media__/${asset.id}`;
      else if (asset.url.startsWith('blob:') || asset.url.startsWith('./__local_media__/')) throw error(400, 'This media belongs to another browser session. Reimport the original file before saving.');
    }
    return result;
  }

  async call(path, options = {}) {
    const parts = path.split('?')[0].split('/').filter(Boolean);
    const method = options.method || 'GET';
    const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    if (parts[0] === 'session') { await this.open(); return {user: USER, storage: true, mode: 'browser'}; }
    if (parts[0] === 'join' || parts[2] === 'invite') {
      throw error(501, 'GitHub Pages is browser-local. Multi-user invitations require the server-backed deployment.');
    }
    if (parts[0] !== 'projects') throw error(404, 'Unknown local storage operation.');
    if (parts.length === 1) {
      if (method === 'GET') return {projects: await this.transaction(['projects'], 'readonly', async ({projects}) =>
        (await request(projects.getAll())).sort((a, b) => b.updated_at - a.updated_at).map(({id, name, revision, updated_at}) => ({id, name, revision, updated_at, role: 'owner'})))};
      if (method !== 'POST') throw error(405, 'Method not supported.');
      const state = await this.canonical(body.state);
      const id = crypto.randomUUID(), now = Date.now();
      state.id = id;
      await this.transaction(['projects', 'versions'], 'readwrite', async ({projects, versions}) => {
        if (await request(projects.count()) >= 100) throw error(409, 'Browser project limit reached (100).');
        await request(projects.add({id, name: clean(state.name) || 'Untitled', state, revision: 1, updated_at: now}));
        await request(versions.add({id: crypto.randomUUID(), project_id: id, state, revision: 1, author: USER.email, label: 'Project created', created_at: now}));
      });
      return {id, revision: 1, role: 'owner', state: await this.hydrate(state)};
    }
    const id = parts[1], sub = parts[2];
    if (!sub && method === 'PUT') {
      if (!Number.isInteger(body?.revision)) throw error(400, 'A base revision is required.');
      const state = await this.canonical(body.state);
      state.id = id;
      const result = await this.transaction(['projects'], 'readwrite', async ({projects}) => {
        const record = await request(projects.get(id));
        if (!record) throw error(404, 'Local project not found.');
        if (body.revision !== record.revision) return {conflict: record};
        const updatedAt = Date.now(), revision = record.revision + 1;
        await request(projects.put({...record, state, name: clean(state.name) || 'Untitled', revision, updated_at: updatedAt}));
        return {revision, updatedAt};
      });
      if (result.conflict) throw error(409, 'Another tab changed this project. Reload or resolve the conflict before saving.',
        {state: await this.hydrate(result.conflict.state), revision: result.conflict.revision});
      return result;
    }
    const project = await this.readProject(id);
    if (!sub && method === 'GET') return {id, state: await this.hydrate(project.state), revision: project.revision, role: 'owner', updatedAt: project.updated_at};
    if (!sub && method === 'DELETE') {
      await this.transaction(['projects', 'versions', 'comments'], 'readwrite', async stores => {
        await request(stores.projects.delete(id));
        for (const name of ['versions', 'comments']) for (const record of await request(stores[name].getAll())) {
          if (record.project_id === id) await request(stores[name].delete(record.id));
        }
      });
      // Keep shared media: another imported project or version may still reference it.
      return {deleted: true};
    }
    if (sub === 'assets' && method === 'POST') {
      const blob = options.body;
      if (!(blob instanceof Blob) || !/^(image|video|audio)\//.test(blob.type)) throw error(415, 'Choose an image, video or audio file.');
      if (blob.size > MAX_MEDIA) throw error(413, 'Media limit is 50 MB per file.');
      const headers = new Headers(options.headers);
      const record = {id: crypto.randomUUID(), project_id: id, name: clean(decodeURIComponent(headers.get('X-File-Name') || 'Media'), 200),
        blob, mime: blob.type, type: blob.type.split('/')[0], size: blob.size};
      await this.transaction(['media'], 'readwrite', async ({media}) => {
        const records = await request(media.getAll());
        if (records.filter(value => value.project_id === id).length >= 200 || records.reduce((n, value) => n + value.size, 0) + blob.size > 1024 ** 3) {
          throw error(413, 'Browser media limit reached (200 files per project / 1 GB total).');
        }
        await request(media.add(record));
      });
      const {blob: omitted, ...asset} = record;
      return {...asset, url: this.objectURL(record)};
    }
    if (sub === 'versions') {
      if (method === 'GET' && !parts[3]) return {versions: await this.transaction(['versions'], 'readonly', async ({versions}) =>
        (await request(versions.getAll())).filter(v => v.project_id === id).sort((a, b) => b.created_at - a.created_at).map(({state, ...v}) => v))};
      if (method === 'GET' && parts[3]) {
        const version = await this.transaction(['versions'], 'readonly', ({versions}) => request(versions.get(parts[3])));
        if (!version || version.project_id !== id) throw error(404, 'Version not found.');
        return {...version, state: await this.hydrate(version.state)};
      }
      if (method === 'POST') {
        const version = {id: crypto.randomUUID(), project_id: id, state: project.state, revision: project.revision,
          author: USER.email, label: clean(body?.label) || `Revision ${project.revision}`, created_at: Date.now()};
        await this.transaction(['versions'], 'readwrite', async ({versions}) => {
          if ((await request(versions.getAll())).filter(v => v.project_id === id).length >= 100) throw error(409, 'Version limit reached (100 per project).');
          await request(versions.add(version));
        });
        return {id: version.id, revision: version.revision};
      }
    }
    if (sub === 'comments') {
      if (method === 'GET') return {comments: await this.transaction(['comments'], 'readonly', async ({comments}) =>
        (await request(comments.getAll())).filter(c => c.project_id === id).sort((a, b) => b.created_at - a.created_at))};
      if (method === 'POST') {
        const text = clean(body?.body, 4000), drawing = JSON.stringify(body?.drawing || []);
        if (!text || !Number.isInteger(body?.frame) || body.frame < 0 || body.frame >= project.state.duration) throw error(400, 'Write a note at a valid project frame.');
        if (!Array.isArray(body.drawing || []) || drawing.length > 70000) throw error(400, 'Annotation is too large or invalid.');
        const comment = {id: crypto.randomUUID(), project_id: id, author_id: USER.id, author: USER.email, body: text,
          drawing, frame: body.frame, resolved: 0, created_at: Date.now()};
        await this.transaction(['comments'], 'readwrite', async ({comments}) => {
          if ((await request(comments.getAll())).filter(c => c.project_id === id).length >= 500) throw error(409, 'Review note limit reached (500).');
          await request(comments.add(comment));
        });
        return {id: comment.id};
      }
      if (parts[3] && ['PATCH', 'DELETE'].includes(method)) {
        await this.transaction(['comments'], 'readwrite', async ({comments}) => {
          const comment = await request(comments.get(parts[3]));
          if (!comment || comment.project_id !== id) throw error(404, 'Note not found.');
          await request(method === 'DELETE' ? comments.delete(comment.id) : comments.put({...comment, resolved: body?.resolved ? 1 : 0}));
        });
        return {ok: true};
      }
    }
    if (sub === 'presence' && method === 'POST') return {presence: []};
    if (sub === 'members' && method === 'GET') return {members: [{user_id: USER.id, email: USER.email, role: 'owner'}], presence: []};
    throw error(405, 'This operation requires the server-backed deployment.');
  }

  async dispose() {
    const db = await this.connection;
    db?.close();
    this.connection = null;
    for (const url of this.urls.values()) this.revokeObjectURL(url);
    this.urls.clear();
  }
}
