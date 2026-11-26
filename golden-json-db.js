'use strict';

// Small Mongoose-shaped JSON persistence layer for the Golden migration.
// It intentionally implements only the operators/methods used by the inspected
// Golden source. It stores documents in data/golden-store.json, never MongoDB.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}
function getPath(obj, key) {
  return String(key).split('.').reduce((v, part) => v == null ? undefined : v[part], obj);
}
function setPath(obj, key, value) {
  const parts = String(key).split('.');
  let ref = obj;
  for (const part of parts.slice(0, -1)) {
    if (!ref[part] || typeof ref[part] !== 'object') ref[part] = {};
    ref = ref[part];
  }
  ref[parts[parts.length - 1]] = value;
}
function unsetPath(obj, key) {
  const parts = String(key).split('.');
  let ref = obj;
  for (const part of parts.slice(0, -1)) {
    if (!ref || typeof ref !== 'object') return;
    ref = ref[part];
  }
  if (ref && typeof ref === 'object') delete ref[parts[parts.length - 1]];
}
function equal(a, b) {
  if (a instanceof Date) a = a.getTime();
  if (b instanceof Date) b = b.getTime();
  if (a && typeof a === 'object' && a._id) a = String(a._id);
  if (b && typeof b === 'object' && b._id) b = String(b._id);
  return String(a) === String(b);
}
function matchesValue(value, condition) {
  if (condition instanceof RegExp) return condition.test(String(value ?? ''));
  if (!condition || typeof condition !== 'object' || Array.isArray(condition) || condition instanceof Date) {
    if (Array.isArray(value)) return value.some(v => equal(v, condition));
    return equal(value, condition);
  }
  for (const [op, expected] of Object.entries(condition)) {
    if (op === '$in' && !expected.some(v => Array.isArray(value) ? value.some(x => equal(x, v)) : equal(value, v))) return false;
    else if (op === '$ne' && equal(value, expected)) return false;
    else if (op === '$gte' && !(value >= expected)) return false;
    else if (op === '$lte' && !(value <= expected)) return false;
    else if (op === '$lt' && !(value < expected)) return false;
    else if (op === '$gt' && !(value > expected)) return false;
    else if (op === '$exists' && ((value !== undefined) !== Boolean(expected))) return false;
    else if (op === '$regex') {
      const re = new RegExp(expected, condition.$options || '');
      if (!re.test(String(value ?? ''))) return false;
    } else if (!op.startsWith('$') && !matchesValue(getPath(value, op), expected)) return false;
  }
  return true;
}
function matches(doc, filter = {}) {
  if (!filter || typeof filter !== 'object') return true;
  for (const [key, expected] of Object.entries(filter)) {
    if (key === '$or') {
      if (!expected.some(q => matches(doc, q))) return false;
    } else if (key === '$and') {
      if (!expected.every(q => matches(doc, q))) return false;
    } else if (key === '$nor') {
      if (expected.some(q => matches(doc, q))) return false;
    } else if (!matchesValue(getPath(doc, key), expected)) return false;
  }
  return true;
}
function applyUpdate(doc, update = {}) {
  const keys = Object.keys(update);
  const operatorMode = keys.some(k => k.startsWith('$'));
  if (!operatorMode) {
    for (const [k, v] of Object.entries(update)) setPath(doc, k, clone(v));
    return doc;
  }
  for (const [op, values] of Object.entries(update)) {
    for (const [key, value] of Object.entries(values || {})) {
      const current = getPath(doc, key);
      if (op === '$set') setPath(doc, key, clone(value));
      else if (op === '$inc') setPath(doc, key, Number(current || 0) + Number(value || 0));
      else if (op === '$unset') unsetPath(doc, key);
      else if (op === '$push') {
        const arr = Array.isArray(current) ? current : [];
        if (value && typeof value === 'object' && Array.isArray(value.$each)) arr.push(...clone(value.$each));
        else arr.push(clone(value));
        setPath(doc, key, arr);
      } else if (op === '$pull') {
        const arr = Array.isArray(current) ? current : [];
        setPath(doc, key, arr.filter(item => !matchesValue(item, value)));
      } else if (op === '$addToSet') {
        const arr = Array.isArray(current) ? current : [];
        const valuesToAdd = value && Array.isArray(value.$each) ? value.$each : [value];
        for (const item of valuesToAdd) if (!arr.some(existing => equal(existing, item))) arr.push(clone(item));
        setPath(doc, key, arr);
      }
    }
  }
  return doc;
}

class JsonQuery {
  constructor(executor, single = false) {
    this.executor = executor;
    this.single = single;
    this.sortSpec = null;
    this.max = null;
    this.projection = null;
  }
  lean() { this.asLean = true; return this; }
  sort(spec) { this.sortSpec = spec; return this; }
  limit(n) { this.max = Math.max(0, Number(n) || 0); return this; }
  select(spec) { this.projection = spec; return this; }
  populate() { return this; } // References are stored as IDs in the JSON migration.
  async exec() { return this.executor(this); }
  then(resolve, reject) { return this.exec().then(resolve, reject); }
  catch(reject) { return this.exec().catch(reject); }
}
function project(doc, spec) {
  if (!spec) return doc;
  const raw = typeof spec === 'string' ? spec.split(/\\s+/).filter(Boolean) : Object.keys(spec);
  const excluded = raw.filter(k => k.startsWith('-') || (typeof spec === 'object' && spec[k] === 0)).map(k => k.replace(/^-/, ''));
  const included = raw.filter(k => !k.startsWith('-') && (typeof spec === 'string' || spec[k])).map(k => k.replace(/^\\+/, ''));
  if (!included.length && excluded.length) {
    const out = clone(doc);
    for (const field of excluded) unsetPath(out, field);
    return out;
  }
  if (!included.length) return doc;
  const out = {};
  for (const field of included) {
    const value = getPath(doc, field);
    if (value !== undefined) setPath(out, field, clone(value));
  }
  if (doc._id !== undefined && !excluded.includes('_id') && out._id === undefined) out._id = doc._id;
  return out;
}

function createJsonDatabase(options = {}) {
  const file = options.filePath || path.join(process.cwd(), 'data', 'golden-store.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let state = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) state = parsed;
  } catch {}
  let writeChain = Promise.resolve();
  const locks = new Map();

  async function persist() {
    const run = writeChain.catch(() => {}).then(async () => {
      const temp = file + '.tmp';
      await fs.promises.writeFile(temp, JSON.stringify(state, null, 2), 'utf8');
      await fs.promises.rename(temp, file);
    });
    writeChain = run;
    return run;
  }
  async function locked(name, fn) {
    const previous = locks.get(name) || Promise.resolve();
    let release;
    const next = new Promise(resolve => { release = resolve; });
    locks.set(name, next);
    await previous.catch(() => {});
    try { return await fn(); }
    finally {
      release();
      if (locks.get(name) === next) locks.delete(name);
    }
  }

  function model(name) {
    if (!state[name] || !Array.isArray(state[name])) state[name] = [];
    const rows = () => state[name];

    class JsonDocument {
      constructor(data = {}) {
        Object.assign(this, clone(data));
        if (!this._id) this._id = crypto.randomUUID();
      }
      async save() {
        return locked(name, async () => {
          const index = rows().findIndex(row => String(row._id) === String(this._id));
          const data = clone(this);
          if (index < 0) rows().push(data); else rows()[index] = data;
          await persist();
          return this;
        });
      }
      async deleteOne() {
        return Model.deleteOne({ _id: this._id });
      }
      toObject() { return clone(this); }
      toJSON() { return clone(this); }
    }

    function Model(data) { return new JsonDocument(data); }
    Model.modelName = name;
    Model.find = filter => new JsonQuery(async q => {
      let found = rows().filter(row => matches(row, filter || {})).map(clone);
      if (q.sortSpec) {
        const entries = Object.entries(q.sortSpec);
        found.sort((a, b) => {
          for (const [key, direction] of entries) {
            const av = getPath(a, key), bv = getPath(b, key);
            if (av === bv) continue;
            if (av === undefined) return direction < 0 ? 1 : -1;
            if (bv === undefined) return direction < 0 ? -1 : 1;
            return (av > bv ? 1 : -1) * (Number(direction) < 0 ? -1 : 1);
          }
          return 0;
        });
      }
      if (q.max !== null) found = found.slice(0, q.max);
      found = found.map(row => project(row, q.projection));
      return q.asLean ? found : found.map(row => Object.assign(new JsonDocument(), row));
    });
    Model.findOne = filter => new JsonQuery(async q => {
      let candidates = rows().filter(row => matches(row, filter || {}));
      if (q.sortSpec) {
        const entries = Object.entries(q.sortSpec);
        candidates.sort((a, b) => {
          for (const [key, direction] of entries) {
            const av = getPath(a, key), bv = getPath(b, key);
            if (av === bv) continue;
            if (av === undefined) return direction < 0 ? 1 : -1;
            if (bv === undefined) return direction < 0 ? -1 : 1;
            return (av > bv ? 1 : -1) * (Number(direction) < 0 ? -1 : 1);
          }
          return 0;
        });
      }
      let found = candidates[0];
      if (!found) return null;
      found = project(clone(found), q.projection);
      return q.asLean ? found : Object.assign(new JsonDocument(), found);
    }, true);
    Model.findById = id => Model.findOne({ _id: id });
    Model.countDocuments = filter => new JsonQuery(async () => rows().filter(row => matches(row, filter || {})).length, true);
    Model.create = async data => {
      if (Array.isArray(data)) {
        const docs = data.map(item => new JsonDocument(item));
        for (const doc of docs) await doc.save();
        return docs;
      }
      const doc = new JsonDocument(data);
      await doc.save();
      return doc;
    };
    Model.insertMany = Model.create;
    Model.updateOne = async (filter, update, options = {}) => locked(name, async () => {
      let doc = rows().find(row => matches(row, filter || {}));
      let upserted = false;
      if (!doc && options.upsert) {
        doc = {};
        for (const [k, v] of Object.entries(filter || {})) if (!k.startsWith('$') && (!v || typeof v !== 'object')) setPath(doc, k, v);
        doc._id ||= crypto.randomUUID();
        rows().push(doc);
        upserted = true;
      }
      if (!doc) return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      applyUpdate(doc, update);
      await persist();
      return { acknowledged: true, matchedCount: upserted ? 0 : 1, modifiedCount: 1, upsertedCount: upserted ? 1 : 0 };
    });
    Model.updateMany = async (filter, update) => locked(name, async () => {
      const found = rows().filter(row => matches(row, filter || {}));
      for (const doc of found) applyUpdate(doc, update);
      if (found.length) await persist();
      return { acknowledged: true, matchedCount: found.length, modifiedCount: found.length };
    });
    Model.findOneAndUpdate = async (filter, update, options = {}) => locked(name, async () => {
      let doc = rows().find(row => matches(row, filter || {}));
      if (!doc && options.upsert) {
        doc = {};
        for (const [k, v] of Object.entries(filter || {})) if (!k.startsWith('$') && (!v || typeof v !== 'object')) setPath(doc, k, v);
        doc._id ||= crypto.randomUUID();
        rows().push(doc);
      }
      if (!doc) return null;
      const before = clone(doc);
      applyUpdate(doc, update);
      await persist();
      const selected = options.new || options.returnDocument === 'after' ? doc : before;
      return Object.assign(new JsonDocument(), clone(selected));
    });
    Model.findOneAndDelete = async filter => locked(name, async () => {
      const index = rows().findIndex(row => matches(row, filter || {}));
      if (index < 0) return null;
      const [removed] = rows().splice(index, 1);
      await persist();
      return Object.assign(new JsonDocument(), clone(removed));
    });
    Model.findByIdAndDelete = id => Model.findOneAndDelete({ _id: id });
    Model.findByIdAndUpdate = (id, update, options) => Model.findOneAndUpdate({ _id: id }, update, options);
    Model.deleteOne = async filter => locked(name, async () => {
      const index = rows().findIndex(row => matches(row, filter || {}));
      if (index < 0) return { acknowledged: true, deletedCount: 0 };
      rows().splice(index, 1);
      await persist();
      return { acknowledged: true, deletedCount: 1 };
    });
    Model.deleteMany = async filter => locked(name, async () => {
      const before = rows().length;
      state[name] = rows().filter(row => !matches(row, filter || {}));
      const deletedCount = before - state[name].length;
      if (deletedCount) await persist();
      return { acknowledged: true, deletedCount };
    });
    return Model;
  }

  return { model, persist, snapshot: () => clone(state), filePath: file };
}

module.exports = { createJsonDatabase };
