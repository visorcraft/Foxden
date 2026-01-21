const test = require("node:test");
const assert = require("node:assert/strict");

function createFakeStorageLocal(initial = {}) {
  const data = { ...initial };

  return {
    _data: data,
    async get(key) {
      if (key === null) {
        return { ...data };
      }

      if (Array.isArray(key)) {
        const out = {};
        for (const k of key) {
          out[k] = data[k];
        }
        return out;
      }

      if (typeof key === "string") {
        return { [key]: data[key] };
      }

      if (key && typeof key === "object") {
        const out = {};
        for (const k of Object.keys(key)) {
          out[k] = data[k];
        }
        return out;
      }

      return {};
    },
    async set(obj) {
      Object.assign(data, obj);
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) {
        delete data[key];
      }
    },
    async clear() {
      for (const key of Object.keys(data)) {
        delete data[key];
      }
    }
  };
}

test("WSPStorageManger._normalizeWorkspaceState normalizes tags/tabs/groups", async () => {
  global.browser = { storage: { local: createFakeStorageLocal() } };
  const { WSPStorageManger } = require("../backend/storage.js");

  const normalized = WSPStorageManger._normalizeWorkspaceState({
    id: "10",
    name: "   ",
    tags: "work,  personal, ,  ",
    tabs: ["1", "x", 2],
    groups: [
      { title: 5, tabs: ["3", "nope"], collapsed: "yes" },
      { title: "empty", tabs: [] }
    ],
    windowId: "42",
    lastActiveTabId: "not-a-number"
  }, 10);

  assert.equal(normalized.id, 10);
  assert.equal(normalized.name, "Unnamed Workspace");
  assert.deepEqual(normalized.tags, ["work", "personal"]);
  assert.deepEqual(normalized.tabs, [1, 2]);
  assert.equal(normalized.windowId, 42);
  assert.equal(normalized.lastActiveTabId, null);
  assert.equal(normalized.groups.length, 1);
  assert.deepEqual(normalized.groups[0].tabs, [3]);
  assert.equal(normalized.groups[0].title, "");
});

test("WSPStorageManger.migrateIfNeeded upgrades schema v0→v1", async () => {
  const storageLocal = createFakeStorageLocal({
    "wsp-settings": { tabLimit: "5", debug: "true" },
    "wsp-templates": [{ id: 123, name: "", color: 7 }],
    "wsp-folders-1": [{ id: 9, name: "", workspaceIds: [1, 2, 3] }],
    "wsp-order-1": [111, 222],
  });

  global.browser = { storage: { local: storageLocal } };
  delete require.cache[require.resolve("../backend/storage.js")];
  const { WSPStorageManger } = require("../backend/storage.js");

  WSPStorageManger.resetWriteQueue();
  const result = await WSPStorageManger.migrateIfNeeded();

  assert.equal(result.migrated, true);
  assert.equal(storageLocal._data["wsp-schema-version"], 1);
  assert.equal(storageLocal._data["wsp-settings"].tabLimit, 5);
  assert.equal(storageLocal._data["wsp-settings"].debug, true);
  assert.equal(storageLocal._data["wsp-order-1"][0], "111");
  assert.equal(storageLocal._data["wsp-templates"][0].id, "123");
  assert.equal(storageLocal._data["wsp-folders-1"][0].id, "9");

  WSPStorageManger.resetWriteQueue();
});

