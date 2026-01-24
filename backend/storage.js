class WSPStorageManger {
  static _schemaVersionKey = "wsp-schema-version";
  static _currentSchemaVersion = 1;

  static _pendingLocalSets = Object.create(null);
  static _pendingLocalRemoves = new Set();
  static _inFlightLocalSets = Object.create(null);
  static _inFlightLocalRemoves = new Set();
  static _flushTimer = null;
  static _flushDelayMs = 150;
  static _flushInFlight = null;

  static resetWriteQueue() {
    if (WSPStorageManger._flushTimer) {
      clearTimeout(WSPStorageManger._flushTimer);
      WSPStorageManger._flushTimer = null;
    }

    WSPStorageManger._pendingLocalSets = Object.create(null);
    WSPStorageManger._pendingLocalRemoves = new Set();
    WSPStorageManger._inFlightLocalSets = Object.create(null);
    WSPStorageManger._inFlightLocalRemoves = new Set();
    WSPStorageManger._flushInFlight = null;
  }

  static _ensureFlushScheduled() {
    if (WSPStorageManger._flushTimer) return;
    WSPStorageManger._flushTimer = setTimeout(() => {
      WSPStorageManger._flushTimer = null;
      WSPStorageManger.flushPending().catch((e) => {
        console.error("Failed to flush storage writes:", e);
      });
    }, WSPStorageManger._flushDelayMs);
  }

  static _queueLocalSet(key, value) {
    WSPStorageManger._pendingLocalRemoves.delete(key);
    WSPStorageManger._pendingLocalSets[key] = value;
    WSPStorageManger._ensureFlushScheduled();
  }

  static _queueLocalRemove(key) {
    delete WSPStorageManger._pendingLocalSets[key];
    WSPStorageManger._pendingLocalRemoves.add(key);
    WSPStorageManger._ensureFlushScheduled();
  }

  static async flushPending() {
    if (WSPStorageManger._flushInFlight) {
      return await WSPStorageManger._flushInFlight;
    }

    const doFlush = async () => {
      const removes = Array.from(WSPStorageManger._pendingLocalRemoves);
      const sets = WSPStorageManger._pendingLocalSets;

      WSPStorageManger._pendingLocalRemoves.clear();
      WSPStorageManger._pendingLocalSets = Object.create(null);

      WSPStorageManger._inFlightLocalRemoves = new Set(removes);
      WSPStorageManger._inFlightLocalSets = sets;

      try {
        if (removes.length > 0) {
          await browser.storage.local.remove(removes);
        }
        const setKeys = Object.keys(sets);
        if (setKeys.length > 0) {
          await browser.storage.local.set(sets);
        }
      } finally {
        WSPStorageManger._inFlightLocalRemoves.clear();
        WSPStorageManger._inFlightLocalSets = Object.create(null);
      }
    };

    WSPStorageManger._flushInFlight = doFlush().finally(() => {
      WSPStorageManger._flushInFlight = null;
    });
    return await WSPStorageManger._flushInFlight;
  }

  static async _getLocalValue(key) {
    if (Object.prototype.hasOwnProperty.call(WSPStorageManger._pendingLocalSets, key)) {
      return WSPStorageManger._pendingLocalSets[key];
    }
    if (WSPStorageManger._pendingLocalRemoves.has(key)) {
      return undefined;
    }
    if (Object.prototype.hasOwnProperty.call(WSPStorageManger._inFlightLocalSets, key)) {
      return WSPStorageManger._inFlightLocalSets[key];
    }
    if (WSPStorageManger._inFlightLocalRemoves.has(key)) {
      return undefined;
    }

    const results = await browser.storage.local.get(key);
    return results[key];
  }

  static _asPlainObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  static _normalizeSettings(value) {
    const obj = WSPStorageManger._asPlainObject(value);
    return {
      ...obj,
      tabLimit: Number.isFinite(Number(obj.tabLimit)) ? Number(obj.tabLimit) : 0,
      showTabLimitWarning: obj.showTabLimitWarning !== false,
      autoDeleteEmptyWorkspaces: !!obj.autoDeleteEmptyWorkspaces,
      autoArchiveEnabled: !!obj.autoArchiveEnabled,
      autoArchiveAfterDays: Number.isFinite(Number(obj.autoArchiveAfterDays)) ? Math.max(0, Number(obj.autoArchiveAfterDays)) : 30,
      debug: !!obj.debug
    };
  }

  static _normalizeWorkspaceState(value, wspId) {
    const obj = WSPStorageManger._asPlainObject(value);

    const normalizeTabId = (tabId) => {
      const id = Number(tabId);
      return Number.isFinite(id) ? id : null;
    };

    const tabs = Array.isArray(obj.tabs) ? obj.tabs : [];
    const normalizedTabs = tabs
      .map(normalizeTabId)
      .filter(tabId => tabId !== null);

    const groups = Array.isArray(obj.groups) ? obj.groups : [];
    const normalizedGroups = [];
    for (const group of groups) {
      const groupObj = WSPStorageManger._asPlainObject(group);
      const groupTabs = Array.isArray(groupObj.tabs) ? groupObj.tabs : [];
      const normalizedGroupTabs = groupTabs
        .map(normalizeTabId)
        .filter(tabId => tabId !== null);

      if (normalizedGroupTabs.length === 0) continue;

      normalizedGroups.push({
        title: typeof groupObj.title === "string" ? groupObj.title : "",
        color: groupObj.color,
        collapsed: !!groupObj.collapsed,
        tabs: normalizedGroupTabs
      });
    }

    const windowId = Number(obj.windowId);
    const lastActiveTabId = normalizeTabId(obj.lastActiveTabId);

    const normalizeTimestampMs = (ts) => {
      const num = Number(ts);
      if (Number.isFinite(num)) return num;
      if (typeof ts === "string") {
        const parsed = Date.parse(ts);
        if (Number.isFinite(parsed)) return parsed;
      }
      return Date.now();
    };

    const lastActivatedAt = normalizeTimestampMs(obj.lastActivatedAt);

    const snoozedUntilRaw = obj.snoozedUntil;
    const snoozedUntilNum = snoozedUntilRaw == null ? null : Number(snoozedUntilRaw);
    const snoozedUntil = snoozedUntilNum != null && Number.isFinite(snoozedUntilNum) ? snoozedUntilNum : null;

    const rawTags = Array.isArray(obj.tags)
      ? obj.tags
      : (typeof obj.tags === "string" ? obj.tags.split(",") : []);

    const tags = rawTags
      .map((t) => (typeof t === "string" ? t : String(t)).trim())
      .filter(t => t.length > 0);

    return {
      id: Number.isFinite(Number(obj.id)) ? Number(obj.id) : Number(wspId),
      name: typeof obj.name === "string" && obj.name.trim().length > 0 ? obj.name : "Unnamed Workspace",
      color: typeof obj.color === "string" ? obj.color : "",
      pinned: !!obj.pinned,
      suspended: !!obj.suspended,
      active: !!obj.active,
      archived: !!obj.archived,
      lastActivatedAt,
      snoozedUntil,
      tags,
      tabs: normalizedTabs,
      groups: normalizedGroups,
      windowId: Number.isFinite(windowId) ? windowId : null,
      lastActiveTabId: lastActiveTabId !== null ? lastActiveTabId : null
    };
  }

  static _normalizeTemplates(value) {
    const templates = Array.isArray(value) ? value : [];
    return templates
      .map((t) => {
        const obj = WSPStorageManger._asPlainObject(t);
        return {
          id: typeof obj.id === "string" ? obj.id : String(obj.id || ""),
          name: typeof obj.name === "string" && obj.name.trim().length > 0 ? obj.name : "Template",
          color: typeof obj.color === "string" ? obj.color : "",
          createdAt: typeof obj.createdAt === "string" ? obj.createdAt : new Date().toISOString(),
          tabs: Array.isArray(obj.tabs) ? obj.tabs : [],
          groups: Array.isArray(obj.groups) ? obj.groups : []
        };
      })
      .filter(t => t.id.length > 0);
  }

  static _normalizeFolders(value) {
    const folders = Array.isArray(value) ? value : [];
    const allowedPinned = new Set(["any", "pinned", "unpinned"]);
    return folders
      .map((f) => {
        const obj = WSPStorageManger._asPlainObject(f);

        const smartObj = WSPStorageManger._asPlainObject(obj.smart);
        const rawSmartTags = Array.isArray(smartObj.tags)
          ? smartObj.tags
          : (typeof smartObj.tags === "string" ? smartObj.tags.split(",") : []);
        const smartTags = rawSmartTags
          .map((t) => (typeof t === "string" ? t : String(t)).trim())
          .filter(t => t.length > 0);

        const rawSmartDomains = Array.isArray(smartObj.domains)
          ? smartObj.domains
          : (typeof smartObj.domains === "string" ? smartObj.domains.split(",") : []);
        const smartDomains = rawSmartDomains
          .map((d) => (typeof d === "string" ? d : String(d)).trim())
          .filter(d => d.length > 0);

        const pinnedRaw = typeof smartObj.pinned === "string" ? smartObj.pinned : "any";
        const pinned = allowedPinned.has(pinnedRaw) ? pinnedRaw : "any";

        return {
          id: typeof obj.id === "string" ? obj.id : String(obj.id || ""),
          name: typeof obj.name === "string" && obj.name.trim().length > 0 ? obj.name : "Folder",
          color: typeof obj.color === "string" ? obj.color : "",
          collapsed: !!obj.collapsed,
          workspaceIds: Array.isArray(obj.workspaceIds) ? obj.workspaceIds.map(id => String(id)) : [],
          smart: {
            enabled: smartObj.enabled === true,
            tags: smartTags,
            domains: smartDomains,
            pinned
          }
        };
      })
      .filter(f => f.id.length > 0);
  }

  static _normalizeRules(value) {
    const rules = Array.isArray(value) ? value : [];
    const allowedTypes = new Set(["domain", "path", "title", "url"]);

    return rules
      .map((r) => {
        const obj = WSPStorageManger._asPlainObject(r);
        const id = typeof obj.id === "string" ? obj.id : String(obj.id || "");
        const matchTypeRaw = typeof obj.matchType === "string" ? obj.matchType : "domain";
        const matchType = allowedTypes.has(matchTypeRaw) ? matchTypeRaw : "domain";
        const pattern = typeof obj.pattern === "string" ? obj.pattern.trim() : "";
        const targetWorkspaceName = typeof obj.targetWorkspaceName === "string" ? obj.targetWorkspaceName.trim() : "";

        return {
          id,
          enabled: obj.enabled !== false,
          matchType,
          pattern,
          targetWorkspaceName
        };
      })
      .filter(r => r.id.length > 0 && r.pattern.length > 0 && r.targetWorkspaceName.length > 0);
  }

  static _normalizeSnoozes(value) {
    const snoozes = Array.isArray(value) ? value : [];
    const allowedTypes = new Set(["workspace", "tabs"]);

    return snoozes
      .map((s) => {
        const obj = WSPStorageManger._asPlainObject(s);
        const id = typeof obj.id === "string" ? obj.id : String(obj.id || "");
        const typeRaw = typeof obj.type === "string" ? obj.type : "workspace";
        const type = allowedTypes.has(typeRaw) ? typeRaw : "workspace";

        const createdAt = Number(obj.createdAt);
        const wakeAt = Number(obj.wakeAt);

        return {
          id,
          type,
          createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
          wakeAt: Number.isFinite(wakeAt) ? wakeAt : null,
          payload: WSPStorageManger._asPlainObject(obj.payload)
        };
      })
      .filter(s => s.id.length > 0 && Number.isFinite(Number(s.wakeAt)));
  }

  static async getSchemaVersion() {
    const value = await WSPStorageManger._getLocalValue(WSPStorageManger._schemaVersionKey);
    const version = Number(value);
    return Number.isFinite(version) ? version : 0;
  }

  static async _setSchemaVersion(version) {
    WSPStorageManger._queueLocalSet(WSPStorageManger._schemaVersionKey, version);
  }

  static async migrateIfNeeded() {
    const fromVersion = await WSPStorageManger.getSchemaVersion();
    const toVersion = WSPStorageManger._currentSchemaVersion;

    if (fromVersion >= toVersion) {
      return { migrated: false, fromVersion, toVersion };
    }

    // Read the full storage once; writes are batched below.
    const all = await browser.storage.local.get(null);
    let nextVersion = fromVersion;

    // v0 → v1: normalize key shapes (settings + folders + templates + workspace order)
    if (nextVersion < 1) {
      WSPStorageManger._queueLocalSet("wsp-settings", WSPStorageManger._normalizeSettings(all["wsp-settings"]));

      WSPStorageManger._queueLocalSet("wsp-templates", WSPStorageManger._normalizeTemplates(all["wsp-templates"]));

      for (const [key, value] of Object.entries(all)) {
        if (!key.startsWith("wsp-folders-")) continue;
        WSPStorageManger._queueLocalSet(key, WSPStorageManger._normalizeFolders(value));
      }

      for (const [key, value] of Object.entries(all)) {
        if (!key.startsWith("wsp-order-")) continue;
        if (!Array.isArray(value)) continue;
        WSPStorageManger._queueLocalSet(key, value.map(id => String(id)));
      }

      nextVersion = 1;
      await WSPStorageManger._setSchemaVersion(nextVersion);
    }

    await WSPStorageManger.flushPending();
    return { migrated: true, fromVersion, toVersion: nextVersion };
  }

  static async getWspState(wspId) {
    const key = `ld-wsp-${wspId}`;
    const value = await WSPStorageManger._getLocalValue(key);
    return WSPStorageManger._normalizeWorkspaceState(value, wspId);
  }

  static async saveWspState(wspId, state) {
    const key = `ld-wsp-${wspId}`;
    WSPStorageManger._queueLocalSet(key, state);
  }

  static async deleteWspState(wspId) {
    const key = `ld-wsp-${wspId}`;
    WSPStorageManger._queueLocalRemove(key);
  }

  static async getWorkspaces(windowId) {
    const key = `ld-wsp-window-${windowId}`;
    const stored = await WSPStorageManger._getLocalValue(key);
    const wspIds = Array.isArray(stored) ? stored : [];

    return await Promise.all(wspIds.map(async wspId => {
      const state = await WSPStorageManger.getWspState(wspId);
      return new Workspace(wspId, state);
    }));
  }

  static async getWindowWorkspaceIds(windowId) {
    const key = `ld-wsp-window-${windowId}`;
    const stored = await WSPStorageManger._getLocalValue(key);
    return Array.isArray(stored) ? stored : [];
  }

  static async saveWindowWorkspaceIds(windowId, workspaceIds) {
    const key = `ld-wsp-window-${windowId}`;
    WSPStorageManger._queueLocalSet(key, Array.isArray(workspaceIds) ? workspaceIds : []);
  }

  static async removeWindowWorkspaceIds(windowId) {
    const key = `ld-wsp-window-${windowId}`;
    WSPStorageManger._queueLocalRemove(key);
    WSPStorageManger._queueLocalRemove(`${key}-first-wsp-creation`);
  }

  static async getWorkspace(wspId) {
    const state = await WSPStorageManger.getWspState(wspId);
    return new Workspace(wspId, state);
  }

  static async getNumWorkspaces(windowId) {
    const key = `ld-wsp-window-${windowId}`;
    const stored = await WSPStorageManger._getLocalValue(key);
    return (Array.isArray(stored) ? stored : []).length;
  }

  static async addWsp(wspId, windowId) {
    const key = `ld-wsp-window-${windowId}`;
    const stored = await WSPStorageManger._getLocalValue(key);
    const wspIds = Array.isArray(stored) ? stored : [];
    if (!wspIds.includes(wspId)) {
      wspIds.push(wspId);
      WSPStorageManger._queueLocalSet(key, wspIds);
    }
  }

  static async removeWsp(wspId, windowId) {
    const key = `ld-wsp-window-${windowId}`;
    const stored = await WSPStorageManger._getLocalValue(key);
    const wspIds = Array.isArray(stored) ? stored : [];

    const idx = wspIds.findIndex(id => id == wspId);

    if (idx === -1) {
      return;
    }

    wspIds.splice(idx, 1);

    WSPStorageManger._queueLocalSet(key, wspIds);

    // Remove from any folders that reference this workspace
    try {
      const wspIdStr = String(wspId);
      const folders = await WSPStorageManger.getFolders(windowId);
      let changed = false;

      for (const folder of folders) {
        if (!Array.isArray(folder.workspaceIds)) continue;
        const before = folder.workspaceIds.length;
        folder.workspaceIds = folder.workspaceIds.filter(id => String(id) !== wspIdStr);
        if (folder.workspaceIds.length !== before) {
          changed = true;
        }
      }

      if (changed) {
        await WSPStorageManger.saveFolders(windowId, folders);
      }
    } catch (e) {
      console.warn("Failed to remove workspace from folders:", e);
    }
  }

  // delete data (window id and associated tabs) associated to window
  static async destroyWindow(windowId) {
    const key = `ld-wsp-window-${windowId}`;
    const stored = await WSPStorageManger._getLocalValue(key);
    const wspIds = Array.isArray(stored) ? stored : [];

    // 1. delete window-id: [array of associated workspaces ids] from local storage
    WSPStorageManger._queueLocalRemove(key);

    // 2. delete all workspace-ids: [array of tabs] associated with that window from local storage
    await Promise.all(wspIds.map(WSPStorageManger.deleteWspState));

    WSPStorageManger._queueLocalRemove(`${key}-first-wsp-creation`);
  }

  static async getNextWspId(windowId) {
    const key = `ld-wsp-window-${windowId}`;
    const stored = await WSPStorageManger._getLocalValue(key);
    const wspIds = Array.isArray(stored) ? stored : [];

    return wspIds[0];
  }

  static async getPrimaryWindowId() {
    const key = `primary-window-id`;
    return await WSPStorageManger._getLocalValue(key);
  }

  static async setPrimaryWindowId(windowId) {
    const key = `primary-window-id`;
    WSPStorageManger._queueLocalSet(key, windowId);
  }

  static async removePrimaryWindowId() {
    const key = `primary-window-id`;
    WSPStorageManger._queueLocalRemove(key);
  }

  static async getPrimaryWindowLastId() {
    const key = `primary-window-last-id`;
    return await WSPStorageManger._getLocalValue(key);
  }

  static async setPrimaryWindowLastId(windowId) {
    const key = `primary-window-last-id`;
    WSPStorageManger._queueLocalSet(key, windowId);
  }

  // Direct write that bypasses the queue - use for critical shutdown operations
  // where we can't wait for the delayed flush
  static async setPrimaryWindowLastIdImmediate(windowId) {
    const key = `primary-window-last-id`;
    await browser.storage.local.set({ [key]: windowId });
  }

  // Direct write that bypasses the queue - use for critical shutdown operations
  static async removePrimaryWindowIdImmediate() {
    const key = `primary-window-id`;
    await browser.storage.local.remove(key);
  }

  static async removePrimaryWindowLastId() {
    const key = `primary-window-last-id`;
    WSPStorageManger._queueLocalRemove(key);
  }

  static async getWindowTabIndexMapping() {
    const key = `primary-window-tab-index-mapping`;
    const value = await WSPStorageManger._getLocalValue(key);
    return Array.isArray(value) ? value : [];
  }

  static async saveWindowTabIndexMapping(mapping) {
    const key = `primary-window-tab-index-mapping`;
    WSPStorageManger._queueLocalSet(key, mapping);
  }

  // Recently closed tabs methods
  static async getRecentlyClosed(wspId) {
    const key = `wsp-recently-closed-${wspId}`;
    const value = await WSPStorageManger._getLocalValue(key);
    return Array.isArray(value) ? value : [];
  }

  static async addRecentlyClosed(wspId, tabData) {
    const key = `wsp-recently-closed-${wspId}`;
    let closedTabs = await WSPStorageManger._getLocalValue(key);
    closedTabs = Array.isArray(closedTabs) ? closedTabs : [];

    // Add to beginning
    closedTabs.unshift({
      url: tabData.url,
      title: tabData.title,
      closedAt: Date.now()
    });

    // Keep only last 10
    closedTabs = closedTabs.slice(0, 10);

    WSPStorageManger._queueLocalSet(key, closedTabs);
  }

  static async removeRecentlyClosed(wspId, index) {
    const key = `wsp-recently-closed-${wspId}`;
    let closedTabs = await WSPStorageManger._getLocalValue(key);
    closedTabs = Array.isArray(closedTabs) ? closedTabs : [];

    if (index >= 0 && index < closedTabs.length) {
      closedTabs.splice(index, 1);
      WSPStorageManger._queueLocalSet(key, closedTabs);
    }
  }

  static async clearRecentlyClosed(wspId) {
    const key = `wsp-recently-closed-${wspId}`;
    WSPStorageManger._queueLocalRemove(key);
  }

  // Template methods
  static async getTemplates() {
    const key = "wsp-templates";
    const value = await WSPStorageManger._getLocalValue(key);
    return WSPStorageManger._normalizeTemplates(value);
  }

  static async saveTemplate(template) {
    const key = "wsp-templates";
    let templates = await WSPStorageManger.getTemplates();

    // Add new template
    templates.push({
      id: `template-${Date.now()}`,
      name: template.name,
      color: template.color || "",
      createdAt: new Date().toISOString(),
      tabs: template.tabs,
      groups: template.groups || []
    });

    WSPStorageManger._queueLocalSet(key, templates);
    return templates;
  }

  static async deleteTemplate(templateId) {
    const key = "wsp-templates";
    let templates = await WSPStorageManger.getTemplates();

    templates = templates.filter(t => t.id !== templateId);
    WSPStorageManger._queueLocalSet(key, templates);
    return templates;
  }

  static async renameTemplate(templateId, newName) {
    const key = "wsp-templates";
    let templates = await WSPStorageManger.getTemplates();

    const template = templates.find(t => t.id === templateId);
    if (template) {
      template.name = newName;
      WSPStorageManger._queueLocalSet(key, templates);
    }
    return templates;
  }

  static async updateTemplate(templateId, updates) {
    const key = "wsp-templates";
    let templates = await WSPStorageManger.getTemplates();

    const template = templates.find(t => t.id === templateId);
    if (template) {
      if (updates.name !== undefined) template.name = updates.name;
      if (updates.color !== undefined) template.color = updates.color;
      WSPStorageManger._queueLocalSet(key, templates);
    }
    return templates;
  }

  // Workspace order methods
  static async getWorkspaceOrder(windowId) {
    const key = `wsp-order-${windowId}`;
    const value = await WSPStorageManger._getLocalValue(key);
    return value || null; // null means use default alphabetical
  }

  static async saveWorkspaceOrder(windowId, orderArray) {
    const key = `wsp-order-${windowId}`;
    WSPStorageManger._queueLocalSet(key, orderArray);
  }

  static async clearWorkspaceOrder(windowId) {
    const key = `wsp-order-${windowId}`;
    WSPStorageManger._queueLocalRemove(key);
  }

  // Settings methods
  static async getSettings() {
    const key = "wsp-settings";
    const value = await WSPStorageManger._getLocalValue(key);
    return WSPStorageManger._normalizeSettings(value);
  }

  static async saveSettings(settings) {
    const key = "wsp-settings";
    WSPStorageManger._queueLocalSet(key, settings);
  }

  static async getTabLimit() {
    const settings = await WSPStorageManger.getSettings();
    return settings.tabLimit || 0;
  }

  static async setTabLimit(limit) {
    const settings = await WSPStorageManger.getSettings();
    settings.tabLimit = limit;
    await WSPStorageManger.saveSettings(settings);
  }

  // Folder methods
  static async getFolders(windowId) {
    const key = `wsp-folders-${windowId}`;
    const value = await WSPStorageManger._getLocalValue(key);
    return WSPStorageManger._normalizeFolders(value);
  }

  static async saveFolders(windowId, folders) {
    const key = `wsp-folders-${windowId}`;
    WSPStorageManger._queueLocalSet(key, WSPStorageManger._normalizeFolders(folders));
  }

  static async clearFolders(windowId) {
    const key = `wsp-folders-${windowId}`;
    WSPStorageManger._queueLocalRemove(key);
  }

  // Rules methods
  static async getRules() {
    const key = "wsp-rules";
    const value = await WSPStorageManger._getLocalValue(key);
    return WSPStorageManger._normalizeRules(value);
  }

  static async saveRules(rules) {
    const key = "wsp-rules";
    WSPStorageManger._queueLocalSet(key, WSPStorageManger._normalizeRules(rules));
  }

  // Snooze methods
  static async getSnoozes() {
    const key = "wsp-snoozes";
    const value = await WSPStorageManger._getLocalValue(key);
    return WSPStorageManger._normalizeSnoozes(value);
  }

  static async saveSnoozes(snoozes) {
    const key = "wsp-snoozes";
    WSPStorageManger._queueLocalSet(key, WSPStorageManger._normalizeSnoozes(snoozes));
  }

  static async addSnooze(snooze) {
    const key = "wsp-snoozes";
    const existing = await WSPStorageManger.getSnoozes();
    const next = existing.concat([snooze]);
    WSPStorageManger._queueLocalSet(key, WSPStorageManger._normalizeSnoozes(next));
    return next;
  }

  static async removeSnooze(snoozeId) {
    const key = "wsp-snoozes";
    const id = (snoozeId || "").toString();
    const existing = await WSPStorageManger.getSnoozes();
    const next = existing.filter(s => s.id !== id);
    WSPStorageManger._queueLocalSet(key, WSPStorageManger._normalizeSnoozes(next));
    return next;
  }

  static async createFolder(windowId, folder) {
    const folders = await WSPStorageManger.getFolders(windowId);
    folders.push({
      id: `folder-${Date.now()}`,
      name: folder.name,
      color: folder.color || "",
      collapsed: false,
      workspaceIds: [],
      smart: {
        enabled: false,
        tags: [],
        domains: [],
        pinned: "any"
      }
    });
    await WSPStorageManger.saveFolders(windowId, folders);
    return folders;
  }

  static async updateFolder(windowId, folderId, updates) {
    const folders = await WSPStorageManger.getFolders(windowId);
    const folder = folders.find(f => f.id === folderId);
    if (folder) {
      if (updates.name !== undefined) folder.name = updates.name;
      if (updates.color !== undefined) folder.color = updates.color;
      if (updates.collapsed !== undefined) folder.collapsed = updates.collapsed;
      if (updates.workspaceIds !== undefined) folder.workspaceIds = updates.workspaceIds;
      if (updates.smart !== undefined) {
        folder.smart = {
          ...(folder.smart && typeof folder.smart === "object" ? folder.smart : {}),
          ...(updates.smart && typeof updates.smart === "object" ? updates.smart : {})
        };
      }
      await WSPStorageManger.saveFolders(windowId, folders);
    }
    return folders;
  }

  static async deleteFolder(windowId, folderId) {
    let folders = await WSPStorageManger.getFolders(windowId);
    folders = folders.filter(f => f.id !== folderId);
    await WSPStorageManger.saveFolders(windowId, folders);
    return folders;
  }

  static async addWorkspaceToFolder(windowId, wspId, folderId) {
    const folders = await WSPStorageManger.getFolders(windowId);
    // Remove from any existing folder
    for (const folder of folders) {
      folder.workspaceIds = folder.workspaceIds.filter(id => id !== wspId);
    }
    // Add to new folder
    const targetFolder = folders.find(f => f.id === folderId);
    if (targetFolder && !targetFolder.workspaceIds.includes(wspId)) {
      targetFolder.workspaceIds.push(wspId);
    }
    await WSPStorageManger.saveFolders(windowId, folders);
    return folders;
  }

  static async removeWorkspaceFromFolder(windowId, wspId) {
    const folders = await WSPStorageManger.getFolders(windowId);
    for (const folder of folders) {
      folder.workspaceIds = folder.workspaceIds.filter(id => id !== wspId);
    }
    await WSPStorageManger.saveFolders(windowId, folders);
    return folders;
  }

}

// Allow minimal unit tests in Node without impacting the WebExtension runtime.
if (typeof module !== "undefined" && module?.exports) {
  module.exports = { WSPStorageManger };
}
