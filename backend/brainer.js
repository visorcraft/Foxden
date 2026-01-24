class Brainer {
  static _suppressTabTrackingCount = 0;
  static _suppressTabTrackingUntil = 0;
  static _activateQueueByWindow = new Map();
  static _lastReconcileAtByWindow = new Map();
  static _lastError = null;
  static _undoState = null;
  static _undoTimer = null;
  static _undoTtlMs = 20000;
  static _autoArchiveInterval = null;
  static _ruleCandidateTabs = new Map();
  static _initialized = false;
  static _wakingSnoozeIds = new Set();

  static isInitialized() {
    return Brainer._initialized;
  }

  static suppressTabTracking(ms = 60000) {
    const duration = Number(ms);
    if (!Number.isFinite(duration) || duration <= 0) {
      Brainer._suppressTabTrackingUntil = 0;
      return;
    }
    const until = Date.now() + duration;
    Brainer._suppressTabTrackingUntil = Math.max(Brainer._suppressTabTrackingUntil, until);
  }

  static async withSuppressedTabTracking(fn) {
    Brainer._suppressTabTrackingCount++;
    try {
      return await fn();
    } finally {
      Brainer._suppressTabTrackingCount = Math.max(0, Brainer._suppressTabTrackingCount - 1);
    }
  }

  static _isTabTrackingSuppressed() {
    if (Brainer._suppressTabTrackingCount > 0) {
      return true;
    }

    if (Brainer._suppressTabTrackingUntil > Date.now()) {
      return true;
    }

    if (Brainer._suppressTabTrackingUntil !== 0) {
      Brainer._suppressTabTrackingUntil = 0;
    }

    return false;
  }

  static _isRuleEligibleUrl(url) {
    const raw = (url || "").toString();
    return raw.startsWith("http://") || raw.startsWith("https://");
  }

  static _globMatch(textLower, patternLower) {
    const text = (textLower || "").toString();
    const pattern = (patternLower || "").toString();
    if (pattern.length === 0) return false;

    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i");
    return regex.test(text);
  }

  static _domainMatches(hostnameLower, patternLower) {
    const host = (hostnameLower || "").toString().trim().toLowerCase().replace(/^www\./, "");
    const pattern = (patternLower || "").toString().trim().toLowerCase().replace(/^www\./, "");
    if (!host || !pattern) return false;

    if (!pattern.includes("*")) {
      return host === pattern || host.endsWith(`.${pattern}`);
    }

    return Brainer._globMatch(host, pattern);
  }

  static _findFirstMatchingRule(rules, { url, title }) {
    const list = Array.isArray(rules) ? rules : [];
    const rawUrl = (url || "").toString();
    const rawTitle = (title || "").toString();
    let urlObj = null;

    for (const rule of list) {
      if (!rule || rule.enabled === false) continue;
      const matchType = (rule.matchType || "domain").toString();
      const pattern = (rule.pattern || "").toString().trim();
      if (!pattern) continue;

      if (matchType === "title") {
        if (Brainer._globMatch(rawTitle.toLowerCase(), pattern.toLowerCase())) {
          return rule;
        }
        continue;
      }

      if (!Brainer._isRuleEligibleUrl(rawUrl)) {
        continue;
      }

      if (!urlObj) {
        try {
          urlObj = new URL(rawUrl);
        } catch (_) {
          continue;
        }
      }

      if (matchType === "domain") {
        if (Brainer._domainMatches(urlObj.hostname, pattern)) {
          return rule;
        }
      } else if (matchType === "path") {
        const path = `${urlObj.pathname || ""}${urlObj.search || ""}`.toLowerCase();
        if (Brainer._globMatch(path, pattern.toLowerCase())) {
          return rule;
        }
      } else if (matchType === "url") {
        if (Brainer._globMatch(rawUrl.toLowerCase(), pattern.toLowerCase())) {
          return rule;
        }
      }
    }

    return null;
  }

  static _trackTabForRules(tabId) {
    const id = Number(tabId);
    if (!Number.isFinite(id)) return;
    if (Brainer._ruleCandidateTabs.has(id)) return;
    Brainer._ruleCandidateTabs.set(id, { firstUrl: null });
  }

  static _untrackTabForRules(tabId) {
    const id = Number(tabId);
    if (!Number.isFinite(id)) return;
    Brainer._ruleCandidateTabs.delete(id);
  }

  static async _applyWorkspaceRuleToTab(tab, rule) {
    const tabId = Number(tab?.id);
    const windowId = Number(tab?.windowId);
    if (!Number.isFinite(tabId) || !Number.isFinite(windowId)) return false;

    const targetName = (rule?.targetWorkspaceName || "").toString().trim();
    if (!targetName) return false;

    const workspaces = await WSPStorageManger.getWorkspaces(windowId);
    const fromWsp = workspaces.find(w => Array.isArray(w.tabs) && w.tabs.includes(tabId));

    const targetNameLower = targetName.toLowerCase();
    let toWsp = workspaces.find(w => (w?.name || "").toString().trim().toLowerCase() === targetNameLower) || null;

    if (!toWsp) {
      const newId = Date.now();
      toWsp = await Workspace.create(newId, {
        id: newId,
        name: targetName,
        color: "",
        pinned: false,
        suspended: false,
        active: false,
        archived: false,
        tags: [],
        tabs: [],
        groups: [],
        windowId,
        lastActiveTabId: null
      });
    } else {
      let changed = false;
      if (toWsp.windowId !== windowId) {
        toWsp.windowId = windowId;
        changed = true;
      }
      if (toWsp.archived) {
        toWsp.archived = false;
        changed = true;
      }
      if (changed) {
        await toWsp._saveState();
      }
    }

    if (!fromWsp || String(fromWsp.id) === String(toWsp.id)) {
      return false;
    }

    await Brainer.moveTabToWsp(tab, fromWsp.id, toWsp.id);
    return true;
  }

  static async applyWorkspaceRulesIfNeeded(tab, changeInfo = {}) {
    const tabId = Number(tab?.id);
    if (!Number.isFinite(tabId)) return;

    const meta = Brainer._ruleCandidateTabs.get(tabId);
    if (!meta) return;

    const rawUrl = (tab?.url || "").toString();
    const url = rawUrl.split("#")[0];

    if (!Brainer._isRuleEligibleUrl(url)) {
      if (changeInfo?.status === "complete") {
        Brainer._untrackTabForRules(tabId);
      }
      return;
    }

    if (!meta.firstUrl) {
      meta.firstUrl = url;
    } else if (meta.firstUrl !== url) {
      Brainer._untrackTabForRules(tabId);
      return;
    }

    const rules = await WSPStorageManger.getRules();
    const match = Brainer._findFirstMatchingRule(rules, { url, title: tab?.title });

    if (match) {
      await Brainer._applyWorkspaceRuleToTab(tab, match);
      Brainer._untrackTabForRules(tabId);
      return;
    }

    if (changeInfo?.status === "complete") {
      Brainer._untrackTabForRules(tabId);
    }
  }

  static async reconcileWorkspaces(windowId, { force = false, throttleMs = 30000 } = {}) {
    const winId = Number(windowId);
    if (!Number.isFinite(winId)) {
      return { success: false, error: "Invalid windowId" };
    }

    const now = Date.now();
    const last = Brainer._lastReconcileAtByWindow.get(winId) || 0;
    if (!force && last && now - last < throttleMs) {
      return { success: true, skipped: true };
    }
    Brainer._lastReconcileAtByWindow.set(winId, now);

    try {
      const openTabs = await browser.tabs.query({ windowId: winId });
      const openTabIds = new Set(openTabs.map(tab => tab.id));

      const normalizeTabId = (tabId) => {
        const id = Number(tabId);
        return Number.isFinite(id) ? id : null;
      };

      const workspaces = await WSPStorageManger.getWorkspaces(winId);
      let changedCount = 0;

      for (const wsp of workspaces) {
        let changed = false;

        if (wsp.windowId !== winId) {
          wsp.windowId = winId;
          changed = true;
        }

        if (typeof wsp.name !== "string" || wsp.name.trim().length === 0) {
          wsp.name = Brainer.generateWspName();
          changed = true;
        }
        wsp.color = typeof wsp.color === "string" ? wsp.color : "";
        wsp.pinned = !!wsp.pinned;
        wsp.suspended = !!wsp.suspended;
        wsp.active = !!wsp.active;
        wsp.archived = !!wsp.archived;

        const lastActivatedAt = Number(wsp.lastActivatedAt);
        if (!Number.isFinite(lastActivatedAt)) {
          wsp.lastActivatedAt = now;
          changed = true;
        } else {
          wsp.lastActivatedAt = lastActivatedAt;
        }

        if (wsp.active && wsp.archived) {
          wsp.archived = false;
          changed = true;
        }

        const snoozedUntilRaw = wsp.snoozedUntil;
        const snoozedUntil = snoozedUntilRaw == null ? null : Number(snoozedUntilRaw);
        if (snoozedUntil != null && !Number.isFinite(snoozedUntil)) {
          wsp.snoozedUntil = null;
          changed = true;
        } else {
          wsp.snoozedUntil = snoozedUntil;
        }

        if (wsp.active && wsp.snoozedUntil != null) {
          wsp.snoozedUntil = null;
          changed = true;
        }

        const tabsBefore = Array.isArray(wsp.tabs) ? wsp.tabs : [];
        const tabsAfter = tabsBefore
          .map(normalizeTabId)
          .filter(tabId => tabId !== null && openTabIds.has(tabId));

        if (!Array.isArray(wsp.tabs) || tabsAfter.length !== tabsBefore.length) {
          changed = true;
        }
        wsp.tabs = tabsAfter;
        const tabsAfterSet = new Set(tabsAfter);

        const lastActive = normalizeTabId(wsp.lastActiveTabId);
        if (lastActive !== null && !openTabIds.has(lastActive)) {
          wsp.lastActiveTabId = null;
          changed = true;
        }

        const groupsBefore = Array.isArray(wsp.groups) ? wsp.groups : [];
        const groupsAfter = [];

        for (const group of groupsBefore) {
          const groupTabsBefore = Array.isArray(group?.tabs) ? group.tabs : [];
          const groupTabsAfter = groupTabsBefore
            .map(normalizeTabId)
            .filter(tabId => tabId !== null && openTabIds.has(tabId) && tabsAfterSet.has(tabId));

          if (groupTabsAfter.length === 0) {
            if (groupTabsBefore.length > 0) {
              changed = true;
            }
            continue;
          }

          if (groupTabsAfter.length !== groupTabsBefore.length) {
            changed = true;
          }

          groupsAfter.push({
            title: group?.title || "",
            color: group?.color,
            collapsed: !!group?.collapsed,
            tabs: groupTabsAfter
          });
        }

        if (!Array.isArray(wsp.groups) || groupsAfter.length !== groupsBefore.length) {
          changed = true;
        }
        wsp.groups = groupsAfter;

        if (changed) {
          await wsp._saveState();
          changedCount++;
        }
      }

      return { success: true, changedCount };
    } catch (e) {
      console.warn("Workspace reconciliation failed:", e);
      return { success: false, error: e?.message ? String(e.message) : String(e) };
    }
  }

  static recordError(context, error) {
    const message = error?.message ? String(error.message) : String(error);
    const stack = error?.stack ? String(error.stack) : null;
    Brainer._lastError = {
      at: new Date().toISOString(),
      context: context ? String(context) : "unknown",
      message,
      stack
    };
  }

  static async getDiagnostics() {
    const manifest = browser.runtime.getManifest();
    const version = manifest?.version || "unknown";
    const primaryWindowId = await WSPStorageManger.getPrimaryWindowId();
    const settings = await WSPStorageManger.getSettings();

    let workspaceCount = 0;
    let workspaceTabCount = 0;
    let openTabsCount = 0;

    if (primaryWindowId) {
      const workspaces = await WSPStorageManger.getWorkspaces(primaryWindowId);
      workspaceCount = workspaces.length;
      workspaceTabCount = workspaces.reduce((sum, wsp) => sum + ((wsp?.tabs || []).length), 0);
      openTabsCount = (await browser.tabs.query({ windowId: primaryWindowId })).length;
    }

    return {
      success: true,
      version,
      primaryWindowId: primaryWindowId || null,
      debug: !!settings?.debug,
      workspaceCount,
      workspaceTabCount,
      openTabsCount,
      lastError: Brainer._lastError
    };
  }

  static _clearUndoState() {
    Brainer._undoState = null;
    if (Brainer._undoTimer) {
      clearTimeout(Brainer._undoTimer);
      Brainer._undoTimer = null;
    }
  }

  static _setUndoState({ type, message, payload, ttlMs } = {}) {
    const now = Date.now();
    const ttl = Number.isFinite(Number(ttlMs)) ? Number(ttlMs) : Brainer._undoTtlMs;
    const expiresAt = now + Math.max(0, ttl);

    Brainer._undoState = {
      type: type ? String(type) : "unknown",
      message: message ? String(message) : "Undo available",
      payload: payload || null,
      expiresAt
    };

    if (Brainer._undoTimer) {
      clearTimeout(Brainer._undoTimer);
    }
    Brainer._undoTimer = setTimeout(() => {
      Brainer._clearUndoState();
    }, ttl);

    return Brainer.getUndoState();
  }

  static getUndoState() {
    const state = Brainer._undoState;
    if (!state) {
      return { success: true, available: false };
    }

    if (Number(state.expiresAt) <= Date.now()) {
      Brainer._clearUndoState();
      return { success: true, available: false };
    }

    return {
      success: true,
      available: true,
      type: state.type,
      message: state.message,
      expiresAt: state.expiresAt
    };
  }

  static _buildGroupIndices(workspace, tabIdsInOrder) {
    const ids = Array.isArray(tabIdsInOrder) ? tabIdsInOrder : [];
    const idToIndex = new Map();
    ids.forEach((id, idx) => idToIndex.set(id, idx));

    const groups = [];
    for (const group of (Array.isArray(workspace?.groups) ? workspace.groups : [])) {
      const indices = (Array.isArray(group?.tabs) ? group.tabs : [])
        .map(tabId => idToIndex.get(tabId))
        .filter(idx => idx !== undefined);

      if (indices.length === 0) continue;

      groups.push({
        title: group.title || group.name || "",
        color: group.color,
        collapsed: !!group.collapsed,
        tabIndices: indices
      });
    }
    return groups;
  }

  static async _restoreTabsFromUndo({ windowId, tabs, groups, targetWorkspaceId } = {}) {
    const winId = Number(windowId);
    const wspId = Number(targetWorkspaceId);
    if (!Number.isFinite(winId) || !Number.isFinite(wspId)) {
      return { success: false, error: "Invalid window/workspace" };
    }

    const workspace = await WSPStorageManger.getWorkspace(wspId);
    if (!workspace) {
      return { success: false, error: "Workspace not found" };
    }

    const tabSpecs = Array.isArray(tabs) ? tabs : [];
    const createdByIndex = [];

    await Brainer.withSuppressedTabTracking(async () => {
      for (const tabData of tabSpecs) {
        const url = tabData?.url ? String(tabData.url) : "";
        if (!url) {
          createdByIndex.push(null);
          continue;
        }

        try {
          const newTab = await browser.tabs.create({
            url,
            active: false,
            windowId: winId
          });
          createdByIndex.push(newTab.id);
        } catch (e) {
          createdByIndex.push(null);
        }
      }
    });

    const restoredTabIds = createdByIndex.filter(Boolean);
    if (restoredTabIds.length === 0) {
      return { success: true, restoredCount: 0 };
    }

    const existing = Array.isArray(workspace.tabs) ? workspace.tabs : [];
    const next = existing.slice();
    const seen = new Set(next);
    for (const tabId of restoredTabIds) {
      if (seen.has(tabId)) continue;
      seen.add(tabId);
      next.push(tabId);
    }
    workspace.tabs = next;

    const newGroups = [];
    for (const group of (Array.isArray(groups) ? groups : [])) {
      const indices = Array.isArray(group.tabIndices) ? group.tabIndices : [];
      const groupTabIds = indices
        .filter(i => Number.isInteger(i) && i >= 0 && i < createdByIndex.length)
        .map(i => createdByIndex[i])
        .filter(Boolean);

      if (groupTabIds.length === 0) continue;

      newGroups.push({
        title: group.title || group.name || "",
        color: group.color,
        collapsed: !!group.collapsed,
        tabs: groupTabIds
      });
    }

    // Only store group config; actual browser groups are created on activation.
    workspace.groups = newGroups;
    await workspace._saveState();
    await WSPStorageManger.flushPending().catch(() => {});

    if (workspace.active) {
      await Brainer.activateWsp(workspace.id, winId, restoredTabIds[0] || null);
    } else {
      await Brainer._safeTabsHide(restoredTabIds);
      await Brainer._safeTabsUngroup(restoredTabIds);
    }

    await Brainer.refreshTabMenu();
    await Brainer.updateBadge();

    return { success: true, restoredCount: restoredTabIds.length };
  }

  static async _restoreClosedTabsToWorkspaces({ windowId, tabs, fallbackWorkspaceId } = {}) {
    const winId = Number(windowId);
    if (!Number.isFinite(winId)) {
      return { success: false, error: "Invalid windowId" };
    }

    const entries = Array.isArray(tabs) ? tabs : [];
    const createdByIndex = [];

    await Brainer.withSuppressedTabTracking(async () => {
      for (const entry of entries) {
        const url = entry?.url ? String(entry.url) : "";
        const pinned = !!entry?.pinned;
        if (!url) {
          createdByIndex.push(null);
          continue;
        }

        try {
          const newTab = await browser.tabs.create({
            url,
            active: false,
            pinned,
            windowId: winId
          });
          createdByIndex.push(newTab.id);
        } catch (e) {
          createdByIndex.push(null);
        }
      }
    });

    const restoredTabIds = createdByIndex.filter(Boolean);
    if (restoredTabIds.length === 0) {
      return { success: true, restoredCount: 0 };
    }

    const workspaces = await WSPStorageManger.getWorkspaces(winId);
    const wspById = new Map(workspaces.map(w => [w.id, w]));

    const fallbackId = Number(fallbackWorkspaceId);
    let fallbackWsp = Number.isFinite(fallbackId) ? wspById.get(fallbackId) : null;
    if (!fallbackWsp) {
      fallbackWsp = workspaces.find(w => w.active) || null;
    }

    const addsByWspId = new Map();
    for (let i = 0; i < entries.length; i++) {
      const newTabId = createdByIndex[i];
      if (!newTabId) continue;

      const entry = entries[i];
      if (entry?.pinned) continue;

      const ownerId = Number(entry?.workspaceId);
      const targetId = Number.isFinite(ownerId) && wspById.has(ownerId)
        ? ownerId
        : (fallbackWsp ? fallbackWsp.id : null);

      if (!targetId) continue;

      if (!addsByWspId.has(targetId)) {
        addsByWspId.set(targetId, []);
      }
      addsByWspId.get(targetId).push(newTabId);
    }

    const tabsToShow = [];
    const tabsToHide = [];

    for (const [wspId, tabIds] of addsByWspId.entries()) {
      const wsp = wspById.get(wspId);
      if (!wsp) continue;

      const existing = Array.isArray(wsp.tabs) ? wsp.tabs : [];
      const next = existing.slice();
      const seen = new Set(next);
      for (const tabId of tabIds) {
        if (seen.has(tabId)) continue;
        seen.add(tabId);
        next.push(tabId);
      }
      wsp.tabs = next;
      await wsp._saveState();

      if (wsp.active) {
        tabsToShow.push(...tabIds);
      } else {
        tabsToHide.push(...tabIds);
      }
    }

    await WSPStorageManger.flushPending().catch(() => {});

    if (tabsToShow.length > 0) {
      await Brainer._safeTabsShow(tabsToShow);
    }
    if (tabsToHide.length > 0) {
      await Brainer._safeTabsHide(tabsToHide);
      await Brainer._safeTabsUngroup(tabsToHide);
    }

    await Brainer.refreshTabMenu();
    await Brainer.updateBadge();

    return { success: true, restoredCount: restoredTabIds.length };
  }

  static async undoLastAction() {
    const publicState = Brainer.getUndoState();
    if (!publicState.available) {
      return { success: false, error: "Nothing to undo" };
    }

    const state = Brainer._undoState;
    const type = state?.type;
    const payload = state?.payload;

    try {
      if (type === "closeWorkspaceTabs") {
        const result = await Brainer._restoreTabsFromUndo(payload || {});
        if (!result?.success) {
          return result;
        }
      } else if (type === "closeTabs") {
        const result = await Brainer._restoreClosedTabsToWorkspaces(payload || {});
        if (!result?.success) {
          return result;
        }
      } else if (type === "destroyWorkspace") {
        const workspaceState = payload?.workspace;
        const wspId = Number(workspaceState?.id);
        const windowId = Number(payload?.windowId);
        const wasActive = !!workspaceState?.active;
        if (!Number.isFinite(wspId) || !Number.isFinite(windowId) || !workspaceState) {
          return { success: false, error: "Invalid undo payload" };
        }

        // Recreate workspace shell
        await Workspace.create(wspId, {
          id: wspId,
          name: workspaceState.name,
          color: workspaceState.color || "",
          pinned: !!workspaceState.pinned,
          suspended: !!workspaceState.suspended,
          active: false,
          archived: !!workspaceState.archived,
          lastActivatedAt: Number.isFinite(Number(workspaceState.lastActivatedAt)) ? Number(workspaceState.lastActivatedAt) : Date.now(),
          tags: Array.isArray(workspaceState.tags) ? workspaceState.tags : [],
          tabs: [],
          groups: [],
          windowId
        });

        const restore = await Brainer._restoreTabsFromUndo({
          windowId,
          targetWorkspaceId: wspId,
          tabs: payload?.tabs,
          groups: payload?.groups
        });

        if (!restore?.success) {
          return restore;
        }

        if (wasActive) {
          await Brainer.activateWsp(wspId, windowId, null);
        }
      } else {
        return { success: false, error: `Unsupported undo type: ${type}` };
      }

      Brainer._clearUndoState();
      return { success: true };
    } catch (e) {
      Brainer.recordError("undoLastAction", e);
      return { success: false, error: e?.message ? String(e.message) : String(e) };
    }
  }

  static async closeWorkspaceTabsWithUndo(wspId) {
    const id = Number(wspId);
    if (!Number.isFinite(id)) {
      return { success: false, error: "Invalid workspace id" };
    }

    const workspace = await WSPStorageManger.getWorkspace(id);
    if (!workspace) {
      return { success: false, error: "Workspace not found" };
    }

    const windowId = Number(workspace.windowId);
    if (!Number.isFinite(windowId)) {
      return { success: false, error: "Invalid workspace windowId" };
    }

    const openTabIds = new Set((await browser.tabs.query({ windowId })).map(tab => tab.id));
    const tabIds = (Array.isArray(workspace.tabs) ? workspace.tabs : []).filter(tabId => openTabIds.has(tabId));

    if (tabIds.length === 0) {
      return { success: true, closedCount: 0, undo: Brainer.getUndoState() };
    }

    const tabs = [];
    for (const tabId of tabIds) {
      try {
        const tab = await browser.tabs.get(tabId);
        tabs.push({ url: tab.url || "", title: tab.title || "" });
      } catch (e) {
        tabs.push({ url: "", title: "" });
      }
    }

    const groups = Brainer._buildGroupIndices(workspace, tabIds);
    const undo = Brainer._setUndoState({
      type: "closeWorkspaceTabs",
      message: `Closed ${tabIds.length} tab(s) in "${workspace.name}".`,
      payload: {
        windowId,
        targetWorkspaceId: id,
        tabs,
        groups
      }
    });

    // Clear stored state first so we don't do per-tab writes on onRemoved.
    workspace.tabs = [];
    workspace.groups = [];
    await workspace._saveState();
    await WSPStorageManger.flushPending().catch(() => {});

    try {
      await browser.tabs.remove(tabIds);
    } catch (e) {
      for (const tabId of tabIds) {
        try {
          await browser.tabs.remove(tabId);
        } catch (_) {}
      }
    }

    await Brainer.refreshTabMenu();
    await Brainer.updateBadge();

    return { success: true, closedCount: tabIds.length, undo };
  }

  static async closeTabsWithUndo(message) {
    const windowId = Number(message?.windowId);
    const rawTabIds = Array.isArray(message?.tabIds) ? message.tabIds : [];
    const tabIds = rawTabIds
      .map(tabId => Number(tabId))
      .filter(tabId => Number.isFinite(tabId));

    if (!Number.isFinite(windowId)) {
      return { success: false, error: "Invalid windowId" };
    }
    if (tabIds.length === 0) {
      return { success: false, error: "No tabIds provided" };
    }

    const workspaces = await WSPStorageManger.getWorkspaces(windowId);
    const activeWsp = workspaces.find(w => w.active) || null;
    const fallbackWorkspaceId = activeWsp ? activeWsp.id : null;

    const ownerByTabId = new Map();
    for (const wsp of workspaces) {
      for (const tabId of (Array.isArray(wsp?.tabs) ? wsp.tabs : [])) {
        if (!ownerByTabId.has(tabId)) {
          ownerByTabId.set(tabId, wsp.id);
        }
      }
    }

    const entries = [];
    const existingTabIds = [];
    for (const tabId of tabIds) {
      try {
        const tab = await browser.tabs.get(tabId);
        entries.push({
          url: tab.url || "",
          title: tab.title || "",
          pinned: !!tab.pinned,
          workspaceId: ownerByTabId.get(tabId) || null
        });
        existingTabIds.push(tabId);
      } catch (_) {
        // Tab may already be gone.
      }
    }

    if (existingTabIds.length === 0) {
      return { success: true, closedCount: 0, undo: Brainer.getUndoState() };
    }

    const toCloseSet = new Set(existingTabIds);
    const touched = [];

    for (const wsp of workspaces) {
      const beforeTabs = Array.isArray(wsp?.tabs) ? wsp.tabs : [];
      const afterTabs = beforeTabs.filter(tabId => !toCloseSet.has(tabId));
      let changed = afterTabs.length !== beforeTabs.length;

      if (changed) {
        wsp.tabs = afterTabs;

        if (Array.isArray(wsp.groups)) {
          for (const group of wsp.groups) {
            if (!Array.isArray(group.tabs)) continue;
            group.tabs = group.tabs.filter(tabId => !toCloseSet.has(tabId));
          }
          wsp.groups = wsp.groups.filter(group => Array.isArray(group.tabs) && group.tabs.length > 0);
        }

        touched.push(wsp);
      }
    }

    if (touched.length > 0) {
      for (const wsp of touched) {
        await wsp._saveState();
      }
      await WSPStorageManger.flushPending().catch(() => {});
    }

    const undo = Brainer._setUndoState({
      type: "closeTabs",
      message: `Closed ${existingTabIds.length} tab(s).`,
      payload: {
        windowId,
        tabs: entries,
        fallbackWorkspaceId
      }
    });

    try {
      await browser.tabs.remove(existingTabIds);
    } catch (e) {
      for (const tabId of existingTabIds) {
        try {
          await browser.tabs.remove(tabId);
        } catch (_) {}
      }
    }

    await Brainer.refreshTabMenu();
    await Brainer.updateBadge();

    return { success: true, closedCount: existingTabIds.length, undo };
  }

  static async destroyWspWithUndo(message) {
    const id = Number(message?.wspId);
    if (!Number.isFinite(id)) {
      return { success: false, error: "Invalid workspace id" };
    }

    const workspace = await WSPStorageManger.getWorkspace(id);
    if (!workspace) {
      return { success: false, error: "Workspace not found" };
    }

    const windowId = Number(workspace.windowId);
    if (!Number.isFinite(windowId)) {
      return { success: false, error: "Invalid workspace windowId" };
    }

    const openTabIds = new Set((await browser.tabs.query({ windowId })).map(tab => tab.id));
    const tabIds = (Array.isArray(workspace.tabs) ? workspace.tabs : []).filter(tabId => openTabIds.has(tabId));

    const tabs = [];
    for (const tabId of tabIds) {
      try {
        const tab = await browser.tabs.get(tabId);
        tabs.push({ url: tab.url || "", title: tab.title || "" });
      } catch (e) {
        tabs.push({ url: "", title: "" });
      }
    }

    const groups = Brainer._buildGroupIndices(workspace, tabIds);
    const hasWasActive = !!(message && Object.prototype.hasOwnProperty.call(message, "wasActive"));
    const wasActive = hasWasActive ? !!message.wasActive : !!workspace.active;

    const undo = Brainer._setUndoState({
      type: "destroyWorkspace",
      message: `Deleted workspace "${workspace.name}".`,
      payload: {
        windowId,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          color: workspace.color || "",
          pinned: !!workspace.pinned,
          suspended: !!workspace.suspended,
          archived: !!workspace.archived,
          lastActivatedAt: Number.isFinite(Number(workspace.lastActivatedAt)) ? Number(workspace.lastActivatedAt) : Date.now(),
          active: wasActive,
          tags: Array.isArray(workspace.tags) ? workspace.tags : []
        },
        tabs,
        groups
      }
    });

    // Clear state first so onRemoved doesn't try to mutate a workspace we're deleting.
    workspace.tabs = [];
    workspace.groups = [];
    await workspace._saveState();
    await WSPStorageManger.flushPending().catch(() => {});

    // Check if we need to switch to another workspace or create a fallback tab
    const allWorkspaces = await WSPStorageManger.getWorkspaces(windowId);
    const remainingWorkspaces = allWorkspaces.filter(w => w.id !== id);
    const allWindowTabs = await browser.tabs.query({ windowId });
    const pinnedTabs = allWindowTabs.filter(t => t.pinned);
    const tabsBeingDeleted = new Set(tabIds);
    const remainingUnpinnedTabs = allWindowTabs.filter(t => !t.pinned && !tabsBeingDeleted.has(t.id));

    // If deleting these tabs would close the window (no tabs left), create a fallback
    let fallbackTabId = null;
    if (remainingUnpinnedTabs.length === 0 && pinnedTabs.length === 0) {
      const fallbackTab = await Brainer.withSuppressedTabTracking(async () => {
        return await browser.tabs.create({ windowId, active: true });
      });
      fallbackTabId = fallbackTab.id;

      if (remainingWorkspaces.length > 0) {
        // Add the fallback tab to another workspace and activate it
        const nextWsp = remainingWorkspaces.find(w => !w.suspended && !w.archived) || remainingWorkspaces[0];
        nextWsp.tabs.push(fallbackTabId);
        nextWsp.active = true;
        await nextWsp._saveState();
      } else {
        // This is the last workspace - create a new one with the fallback tab
        const newWspId = Date.now();
        await Workspace.create(newWspId, {
          id: newWspId,
          name: Brainer.generateWspName(),
          color: "",
          pinned: false,
          suspended: false,
          active: true,
          tabs: [fallbackTabId],
          groups: [],
          windowId,
          lastActiveTabId: fallbackTabId
        });
      }
    } else if (wasActive && remainingWorkspaces.length > 0) {
      // Switch to another workspace before deleting
      const nextWsp = remainingWorkspaces.find(w => !w.suspended && !w.archived) || remainingWorkspaces[0];
      await Brainer.activateWsp(nextWsp.id, windowId, null);
    }

    // Close tabs, then remove workspace.
    try {
      await browser.tabs.remove(tabIds);
    } catch (e) {
      for (const tabId of tabIds) {
        try {
          await browser.tabs.remove(tabId);
        } catch (_) {}
      }
    }

    await WSPStorageManger.deleteWspState(id);
    await WSPStorageManger.removeWsp(id, windowId);
    await WSPStorageManger.flushPending().catch(() => {});

    await Brainer.refreshTabMenu();
    await Brainer.updateBadge();

    return { success: true, undo };
  }

  static async resetAllData(windowId) {
    try {
      const winId = Number(windowId);
      const targetWindowId = Number.isFinite(winId) ? winId : (await browser.windows.getCurrent()).id;

      // Unhide + ungroup tabs so the user doesn't "lose" hidden workspaces after a reset.
      const unpinnedTabs = await browser.tabs.query({ windowId: targetWindowId, pinned: false });
      let unpinnedTabIds = unpinnedTabs.map(tab => tab.id);

      if (unpinnedTabIds.length === 0) {
        const newTab = await Brainer.withSuppressedTabTracking(async () => {
          return await browser.tabs.create({ windowId: targetWindowId, active: true });
        });
        unpinnedTabIds = [newTab.id];
      }

      await Brainer._safeTabsShow(unpinnedTabIds);
      await Brainer._safeTabsUngroup(unpinnedTabIds);

      // Clear storage and reset write queue to prevent stale queued writes from reappearing.
      WSPStorageManger.resetWriteQueue();
      await browser.storage.local.clear();
      WSPStorageManger.resetWriteQueue();

      await WSPStorageManger.migrateIfNeeded().catch(() => {});

      await WSPStorageManger.setPrimaryWindowId(targetWindowId);

      const wspId = Date.now();
      const wsp = {
        id: wspId,
        name: Brainer.generateWspName(),
        color: "",
        pinned: false,
        suspended: false,
        active: true,
        tabs: unpinnedTabIds,
        groups: [],
        windowId: targetWindowId,
        lastActiveTabId: unpinnedTabIds[0] || null,
      };

      const workspace = await Workspace.create(wspId, wsp);
      await workspace.updateTabGroups().catch(() => {});

      await WSPStorageManger.flushPending().catch(() => {});
      await Brainer.refreshTabMenu();
      await Brainer.updateBadge();

      return { success: true, windowId: targetWindowId, workspaceId: wspId };
    } catch (e) {
      Brainer.recordError("resetAllData", e);
      return { success: false, error: e?.message ? String(e.message) : String(e) };
    }
  }

  static async rebindPrimaryWindow(oldWindowId, newWindowId) {
    const oldId = Number(oldWindowId);
    const newId = Number(newWindowId);

    if (!Number.isFinite(oldId) || !Number.isFinite(newId)) {
      return { success: false, error: "Invalid windowId" };
    }

    try {
      const oldWorkspaces = await WSPStorageManger.getWorkspaces(oldId);
      const existingIds = await WSPStorageManger.getWindowWorkspaceIds(newId);

      const mergedIds = Array.isArray(existingIds) ? [...existingIds] : [];
      const mergedIdSet = new Set(mergedIds.map(id => String(id)));
      const addId = (id) => {
        const key = String(id);
        if (mergedIdSet.has(key)) return;
        mergedIdSet.add(key);
        mergedIds.push(id);
      };

      for (const wsp of oldWorkspaces) {
        wsp.windowId = newId;
        wsp.active = false;
        wsp.tabs = [];
        wsp.groups = [];
        wsp.lastActiveTabId = null;
        await wsp._saveState();
        addId(wsp.id);
      }

      await WSPStorageManger.saveWindowWorkspaceIds(newId, mergedIds);
      await WSPStorageManger.removeWindowWorkspaceIds(oldId);

      // Move/merge folder definitions so migrated workspaces aren't stranded.
      const oldFolders = await WSPStorageManger.getFolders(oldId);
      const newFolders = await WSPStorageManger.getFolders(newId);
      const folderIds = new Set((newFolders || []).map(f => String(f?.id)));

      const migratedFolders = [];
      let suffix = 0;
      for (const folder of (oldFolders || [])) {
        const f = { ...(folder || {}) };
        if (folderIds.has(String(f.id))) {
          f.id = `folder-${Date.now()}-${++suffix}`;
        }
        folderIds.add(String(f.id));
        migratedFolders.push(f);
      }

      if ((newFolders || []).length > 0 || migratedFolders.length > 0) {
        await WSPStorageManger.saveFolders(newId, [...(newFolders || []), ...migratedFolders]);
      }
      await WSPStorageManger.clearFolders(oldId);

      // Move/merge custom order
      const oldOrder = await WSPStorageManger.getWorkspaceOrder(oldId);
      const newOrder = await WSPStorageManger.getWorkspaceOrder(newId);

      let mergedOrder = Array.isArray(newOrder) && newOrder.length > 0
        ? newOrder.map(String)
        : (Array.isArray(oldOrder) && oldOrder.length > 0 ? oldOrder.map(String) : null);

      if (mergedOrder) {
        const orderSet = new Set(mergedOrder);
        for (const id of mergedIds) {
          const sid = String(id);
          if (!orderSet.has(sid)) {
            mergedOrder.push(sid);
            orderSet.add(sid);
          }
        }
        await WSPStorageManger.saveWorkspaceOrder(newId, mergedOrder);
      }
      await WSPStorageManger.clearWorkspaceOrder(oldId);

      await WSPStorageManger.setPrimaryWindowId(newId);
      await WSPStorageManger.removePrimaryWindowLastId();

      // Migrate snoozed payload windowIds to the new primary window.
      try {
        const snoozes = await WSPStorageManger.getSnoozes();
        const oldIdNum = Number(oldId);
        const newIdNum = Number(newId);

        let changed = false;
        const next = (Array.isArray(snoozes) ? snoozes : []).map((s) => {
          if (!s || typeof s !== "object") return s;
          const payload = s.payload && typeof s.payload === "object" ? { ...s.payload } : null;
          const payloadWin = payload?.windowId == null ? null : Number(payload.windowId);
          if (payload && Number.isFinite(oldIdNum) && Number.isFinite(newIdNum) && payloadWin === oldIdNum) {
            payload.windowId = newIdNum;
            changed = true;
            return { ...s, payload };
          }
          return s;
        });

        if (changed) {
          await WSPStorageManger.saveSnoozes(next);
        }
      } catch (_) {}

      // Ensure the new primary window has an active workspace that captures its visible tabs.
      await Brainer.reconcileWorkspaces(newId, { force: true, throttleMs: 0 }).catch(() => {});
      const workspaces = await WSPStorageManger.getWorkspaces(newId);
      let activeWsp = workspaces.find(w => w.active) || null;

      const currentTabs = await browser.tabs.query({ windowId: newId, pinned: false });
      const currentTabIds = currentTabs.map(tab => tab.id);

      if (!activeWsp) {
        const wspId = Date.now();
        const wsp = {
          id: wspId,
          name: Brainer.generateWspName(),
          color: "",
          pinned: false,
          suspended: false,
          active: true,
          tabs: currentTabIds,
          groups: [],
          windowId: newId,
          lastActiveTabId: currentTabIds[0] || null
        };
        activeWsp = await Workspace.create(wspId, wsp);
      } else {
        const tabsToAdd = currentTabIds.filter(tabId => workspaces.every(w => !w.tabs.includes(tabId)));
        if (tabsToAdd.length > 0) {
          activeWsp.tabs.unshift(...tabsToAdd);
          await activeWsp.updateTabGroups().catch(() => {});
          await activeWsp._saveState();
        }
      }

      await WSPStorageManger.flushPending().catch(() => {});
      await Brainer.refreshTabMenu();
      await Brainer.updateBadge();

      return { success: true, oldWindowId: oldId, newWindowId: newId };
    } catch (e) {
      Brainer.recordError("rebindPrimaryWindow", e);
      return { success: false, error: e?.message ? String(e.message) : String(e) };
    }
  }

  static async claimPrimaryWindow(windowId) {
    const newId = Number(windowId);
    if (!Number.isFinite(newId)) {
      return { success: false, error: "Invalid windowId" };
    }

    try {
      console.log("[Foxden] claimPrimaryWindow called with windowId:", newId);

      // Check if there's an old window ID to migrate from
      const oldWindowId = await WSPStorageManger.getPrimaryWindowLastId();
      console.log("[Foxden] claimPrimaryWindow: oldWindowId from storage:", oldWindowId);

      if (oldWindowId != null) {
        // Migrate workspaces from the old window
        const oldWorkspaces = await WSPStorageManger.getWorkspaces(oldWindowId);
        console.log("[Foxden] claimPrimaryWindow: found", oldWorkspaces.length, "workspaces from old window");

        if (oldWorkspaces.length > 0) {
          // Get current tabs for URL-based matching
          const currentTabs = await browser.tabs.query({ windowId: newId, pinned: false });
          const currentTabIds = currentTabs.map(tab => tab.id);

          // Build URL-to-tab-ID mapping for matching tabs
          const urlToNewTabId = {};
          for (const tab of currentTabs) {
            if (tab.url) {
              urlToNewTabId[tab.url] = tab.id;
            }
          }

          await WSPStorageManger.setPrimaryWindowId(newId);

          const sameWindow = oldWindowId === newId;
          const assignedTabIds = new Set();

          // Migrate each workspace to the new window
          for (const wsp of oldWorkspaces) {
            wsp.windowId = newId;

            if (sameWindow) {
              // Same window - tab IDs are still valid, keep them
              // Just filter out any that no longer exist
              const validTabIds = wsp.tabs.filter(tabId => currentTabIds.includes(tabId));
              wsp.tabs = validTabIds;
              validTabIds.forEach(id => assignedTabIds.add(id));
            } else {
              // Different window - use URL-based matching
              const tabUrls = wsp.tabUrls || {};
              const newTabIds = [];

              for (const oldTabId of wsp.tabs) {
                const url = tabUrls[oldTabId];
                if (url && urlToNewTabId[url]) {
                  const newTabId = urlToNewTabId[url];
                  if (!assignedTabIds.has(newTabId)) {
                    newTabIds.push(newTabId);
                    assignedTabIds.add(newTabId);
                  }
                }
              }

              wsp.tabs = newTabIds;
              wsp.groups = []; // Groups need to be rebuilt
              wsp.lastActiveTabId = newTabIds[0] || null;
            }

            await wsp._saveState();
            if (!sameWindow) {
              await WSPStorageManger.addWsp(wsp.id, newId);
            }
          }

          // Remove old window's workspace list only if window ID changed
          if (!sameWindow) {
            await WSPStorageManger.removeWindowWorkspaceIds(oldWindowId);
          }

          // Migrate folders
          const oldFolders = await WSPStorageManger.getFolders(oldWindowId);
          if (oldFolders && oldFolders.length > 0) {
            await WSPStorageManger.saveFolders(newId, oldFolders);
            if (!sameWindow) {
              await WSPStorageManger.saveFolders(oldWindowId, []);
            }
          }

          // Add unassigned tabs to the active workspace
          let activeWsp = oldWorkspaces.find(w => w.active);
          if (!activeWsp && oldWorkspaces.length > 0) {
            activeWsp = oldWorkspaces[0];
            activeWsp.active = true;
          }

          if (activeWsp) {
            const unassignedTabs = currentTabIds.filter(id => !assignedTabIds.has(id));
            if (unassignedTabs.length > 0) {
              activeWsp.tabs.push(...unassignedTabs);
              activeWsp.lastActiveTabId = activeWsp.lastActiveTabId || activeWsp.tabs[0];
              await activeWsp._saveState();
            }
          }

          await WSPStorageManger.removePrimaryWindowLastId();
          await WSPStorageManger.flushPending().catch(() => {});
          await Brainer.refreshTabMenu();
          await Brainer.updateBadge();

          return { success: true, windowId: newId, migrated: true };
        }
      }

      // No old workspaces to migrate - set up fresh
      await WSPStorageManger.setPrimaryWindowId(newId);
      await WSPStorageManger.removePrimaryWindowLastId();

      // Check if there's already an active workspace for this window
      const workspaces = await WSPStorageManger.getWorkspaces(newId);
      let activeWsp = workspaces.find(w => w.active) || null;

      if (!activeWsp) {
        // Create a default workspace with current tabs
        const currentTabs = await browser.tabs.query({ windowId: newId, pinned: false });
        const currentTabIds = currentTabs.map(tab => tab.id);

        const wspId = Date.now();
        const wsp = {
          id: wspId,
          name: Brainer.generateWspName(),
          color: "",
          pinned: false,
          suspended: false,
          active: true,
          tabs: currentTabIds,
          groups: [],
          windowId: newId,
          lastActiveTabId: currentTabIds[0] || null
        };
        await Workspace.create(wspId, wsp);
      }

      await WSPStorageManger.flushPending().catch(() => {});
      await Brainer.refreshTabMenu();
      await Brainer.updateBadge();

      return { success: true, windowId: newId };
    } catch (e) {
      Brainer.recordError("claimPrimaryWindow", e);
      return { success: false, error: e?.message ? String(e.message) : String(e) };
    }
  }

  static async getWorkspacesInUiOrder(windowId) {
    const workspaces = (await WSPStorageManger.getWorkspaces(windowId)).filter(w => !w.archived && w.snoozedUntil == null);
    const customOrder = await WSPStorageManger.getWorkspaceOrder(windowId);

    workspaces.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;

      if (customOrder) {
        const aIndex = customOrder.indexOf(String(a.id));
        const bIndex = customOrder.indexOf(String(b.id));
        const aOrder = aIndex === -1 ? 9999 : aIndex;
        const bOrder = bIndex === -1 ? 9999 : bIndex;
        if (aOrder !== bOrder) return aOrder - bOrder;
      }

      return a.name.localeCompare(b.name);
    });

    return workspaces;
  }

  static async autoArchiveInactiveWorkspaces() {
    try {
      const settings = await WSPStorageManger.getSettings();
      if (!settings?.autoArchiveEnabled) {
        return { success: true, archivedCount: 0 };
      }

      const days = Number(settings.autoArchiveAfterDays);
      if (!Number.isFinite(days) || days <= 0) {
        return { success: true, archivedCount: 0 };
      }

      const primaryWindowId = await WSPStorageManger.getPrimaryWindowId();
      if (!primaryWindowId) {
        return { success: true, archivedCount: 0 };
      }

      const thresholdMs = days * 24 * 60 * 60 * 1000;
      const now = Date.now();

      const workspaces = await WSPStorageManger.getWorkspaces(primaryWindowId);
      let archivedCount = 0;

      for (const wsp of workspaces) {
        if (wsp.active) continue;
        if (wsp.pinned) continue;
        if (wsp.archived) continue;

        const last = Number(wsp.lastActivatedAt);
        if (!Number.isFinite(last)) continue;

        if (now - last < thresholdMs) continue;

        wsp.archived = true;
        await wsp._saveState();
        archivedCount++;
      }

      if (archivedCount > 0) {
        await WSPStorageManger.flushPending().catch(() => {});
        await Brainer.refreshTabMenu();
      }

      return { success: true, archivedCount };
    } catch (e) {
      Brainer.recordError("autoArchiveInactiveWorkspaces", e);
      return { success: false, error: e?.message ? String(e.message) : String(e) };
    }
  }

  static _snoozeAlarmName(id) {
    return `wsp-snooze:${String(id)}`;
  }

  static async getSnoozes() {
    const snoozes = await WSPStorageManger.getSnoozes();
    const list = Array.isArray(snoozes) ? snoozes : [];
    list.sort((a, b) => Number(a.wakeAt) - Number(b.wakeAt));
    return list;
  }

  static async _syncSnoozeAlarms() {
    if (!browser?.alarms) return;

    const snoozes = await Brainer.getSnoozes();
    const now = Date.now();

    for (const snooze of snoozes) {
      const wakeAt = Number(snooze?.wakeAt);
      if (!Number.isFinite(wakeAt)) continue;

      if (wakeAt <= now) {
        // Best-effort wake overdue items.
        await Brainer._wakeSnoozeById(snooze.id).catch(() => {});
        continue;
      }

      try {
        browser.alarms.create(Brainer._snoozeAlarmName(snooze.id), { when: wakeAt });
      } catch (e) {
        // ignore
      }
    }
  }

  static async cancelSnooze(message) {
    const snoozeId = (message?.snoozeId || "").toString();
    if (!snoozeId) {
      return { success: false, error: "Invalid snoozeId" };
    }

    const snoozes = await Brainer.getSnoozes();
    const item = snoozes.find(s => s.id === snoozeId) || null;

    await WSPStorageManger.removeSnooze(snoozeId);
    await WSPStorageManger.flushPending().catch(() => {});

    try {
      await browser.alarms?.clear(Brainer._snoozeAlarmName(snoozeId));
    } catch (_) {}

    if (item?.type === "workspace") {
      const wspId = Number(item?.payload?.workspaceId);
      if (Number.isFinite(wspId)) {
        const workspace = await WSPStorageManger.getWorkspace(wspId).catch(() => null);
        if (workspace) {
          workspace.snoozedUntil = null;
          await workspace._saveState();
          await WSPStorageManger.flushPending().catch(() => {});
          await Brainer.refreshTabMenu();
          await Brainer.updateBadge();
        }
      }
    }

    return { success: true };
  }

  static async wakeSnoozeNow(message) {
    const snoozeId = (message?.snoozeId || "").toString();
    if (!snoozeId) {
      return { success: false, error: "Invalid snoozeId" };
    }

    await Brainer._wakeSnoozeById(snoozeId);
    return { success: true };
  }

  static async _wakeSnoozeById(snoozeId) {
    const id = (snoozeId || "").toString();
    if (!id) return;

    if (!Brainer._wakingSnoozeIds) {
      Brainer._wakingSnoozeIds = new Set();
    }
    if (Brainer._wakingSnoozeIds.has(id)) return;
    Brainer._wakingSnoozeIds.add(id);

    try {
      const snoozes = await Brainer.getSnoozes();
      const item = snoozes.find(s => s.id === id);
      if (!item) return;

      const type = item.type;
      const payload = item.payload || {};
      let result = { success: true };

      if (type === "workspace") {
        result = await Brainer._restoreSnoozedWorkspace(payload);
      } else if (type === "tabs") {
        result = await Brainer._restoreSnoozedTabs(payload);
      }

      if (result?.success === false) {
        // Best-effort retry with backoff. Keep the snooze item in storage.
        const retryAt = Date.now() + 5 * 60 * 1000;
        try {
          const next = snoozes.map(s => (s.id === id ? { ...s, wakeAt: retryAt } : s));
          await WSPStorageManger.saveSnoozes(next);
          await WSPStorageManger.flushPending().catch(() => {});
          browser.alarms?.create(Brainer._snoozeAlarmName(id), { when: retryAt });
        } catch (_) {}
        return;
      }

      await WSPStorageManger.removeSnooze(id);
      await WSPStorageManger.flushPending().catch(() => {});

      try {
        await browser.alarms?.clear(Brainer._snoozeAlarmName(id));
      } catch (_) {}
    } finally {
      Brainer._wakingSnoozeIds.delete(id);
    }
  }

  static async _restoreSnoozedWorkspace(payload) {
    const windowId = Number(payload?.windowId);
    const workspaceId = Number(payload?.workspaceId);
    const activate = payload?.activateOnWake !== false;

    if (!Number.isFinite(windowId) || !Number.isFinite(workspaceId)) {
      return { success: false, error: "Invalid snooze payload" };
    }

    const snapshot = payload?.workspace || {};
    const tabs = Array.isArray(payload?.tabs) ? payload.tabs : [];
    const groups = Array.isArray(payload?.groups) ? payload.groups : [];

    let workspace = await WSPStorageManger.getWorkspace(workspaceId).catch(() => null);
    if (!workspace) {
      await Workspace.create(workspaceId, {
        id: workspaceId,
        name: (snapshot?.name || "Snoozed Workspace").toString(),
        color: typeof snapshot?.color === "string" ? snapshot.color : "",
        pinned: !!snapshot?.pinned,
        suspended: false,
        active: false,
        archived: false,
        snoozedUntil: null,
        lastActivatedAt: Date.now(),
        tags: Array.isArray(snapshot?.tags) ? snapshot.tags : [],
        tabs: [],
        groups: [],
        windowId,
        lastActiveTabId: null
      });
      workspace = await WSPStorageManger.getWorkspace(workspaceId).catch(() => null);
      if (!workspace) return { success: false, error: "Failed to create workspace" };
    }

    let changed = false;
    if (workspace.windowId !== windowId) {
      workspace.windowId = windowId;
      changed = true;
    }
    if (changed) {
      await workspace._saveState();
      await WSPStorageManger.flushPending().catch(() => {});
    }

    const restore = await Brainer._restoreTabsFromUndo({
      windowId,
      targetWorkspaceId: workspace.id,
      tabs,
      groups
    });

    if (restore?.success === false) {
      return restore;
    }

    workspace.archived = false;
    workspace.snoozedUntil = null;
    await workspace._saveState();
    await WSPStorageManger.flushPending().catch(() => {});

    if (activate) {
      await Brainer.activateWsp(workspace.id, windowId, null).catch(() => {});
    }

    return { success: true, restoredCount: Number(restore?.restoredCount) || 0 };
  }

  static async _restoreSnoozedTabs(payload) {
    const windowId = Number(payload?.windowId);
    if (!Number.isFinite(windowId)) return { success: false, error: "Invalid snooze payload" };

    const tabs = Array.isArray(payload?.tabs) ? payload.tabs : [];
    if (tabs.length === 0) return { success: true, restoredCount: 0 };

    const restore = await Brainer._restoreClosedTabsToWorkspaces({
      windowId,
      tabs,
      fallbackWorkspaceId: payload?.fallbackWorkspaceId
    });

    if (restore?.success === false) {
      return restore;
    }

    if (payload?.activateOnWake && Number.isFinite(Number(payload?.activateWorkspaceId))) {
      await Brainer.activateWsp(Number(payload.activateWorkspaceId), windowId, null).catch(() => {});
    }

    return { success: true, restoredCount: Number(restore?.restoredCount) || 0 };
  }

  static async snoozeWorkspace(message) {
    try {
      const wspId = Number(message?.wspId);
      const wakeAt = Number(message?.wakeAt);
      const activateOnWake = message?.activateOnWake !== false;

      if (!Number.isFinite(wspId)) {
        return { success: false, error: "Invalid workspace id" };
      }
      if (!Number.isFinite(wakeAt) || wakeAt <= Date.now()) {
        return { success: false, error: "Invalid wake time" };
      }

      const workspace = await WSPStorageManger.getWorkspace(wspId);
      if (!workspace) {
        return { success: false, error: "Workspace not found" };
      }

      const windowId = Number(workspace.windowId);
      if (!Number.isFinite(windowId)) {
        return { success: false, error: "Invalid workspace windowId" };
      }

      const openTabIds = new Set((await browser.tabs.query({ windowId })).map(tab => tab.id));
      const tabIds = (Array.isArray(workspace.tabs) ? workspace.tabs : []).filter(tabId => openTabIds.has(tabId));

      const tabs = [];
      for (const tabId of tabIds) {
        try {
          const tab = await browser.tabs.get(tabId);
          tabs.push({ url: tab.url || "", title: tab.title || "" });
        } catch (_) {
          tabs.push({ url: "", title: "" });
        }
      }

      const groups = Brainer._buildGroupIndices(workspace, tabIds);

      // If snoozing the active workspace, move the user to a different one (or create a new one).
	      if (workspace.active) {
	        const workspaces = await WSPStorageManger.getWorkspaces(windowId);
	        const fallback = workspaces.find(w =>
	          String(w.id) !== String(workspace.id) &&
	          !w.archived &&
	          w.snoozedUntil == null
	        ) || null;

        if (fallback) {
          await Brainer.activateWsp(fallback.id, windowId, null).catch(() => {});
        } else {
          const newTab = await Brainer.withSuppressedTabTracking(async () => {
            return await browser.tabs.create({ windowId, active: true });
          });

          const newWspId = Date.now();
          await Workspace.create(newWspId, {
            id: newWspId,
            name: Brainer.generateWspName(),
            color: "",
            pinned: false,
            suspended: false,
            active: true,
            archived: false,
            snoozedUntil: null,
            lastActivatedAt: Date.now(),
            tags: [],
            tabs: newTab?.id ? [newTab.id] : [],
            groups: [],
            windowId,
            lastActiveTabId: newTab?.id || null
          });

          await Brainer.activateWsp(newWspId, windowId, newTab?.id || null).catch(() => {});
        }
      }

      const snoozeId = `snooze-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const snooze = {
        id: snoozeId,
        type: "workspace",
        createdAt: Date.now(),
        wakeAt,
        payload: {
          windowId,
          workspaceId: workspace.id,
          activateOnWake,
          workspace: {
            id: workspace.id,
            name: workspace.name,
            color: workspace.color || "",
            pinned: !!workspace.pinned,
            tags: Array.isArray(workspace.tags) ? workspace.tags : []
          },
          tabs,
          groups
        }
      };

      // Mark workspace as snoozed and clear its tab state.
      workspace.active = false;
      workspace.archived = false;
      workspace.snoozedUntil = wakeAt;
      workspace.tabs = [];
      workspace.groups = [];
      await workspace._saveState();
      await WSPStorageManger.addSnooze(snooze);
      await WSPStorageManger.flushPending().catch(() => {});

      // Close the tabs belonging to the snoozed workspace.
      if (tabIds.length > 0) {
        await Brainer.withSuppressedTabTracking(async () => {
          try {
            await browser.tabs.remove(tabIds);
          } catch (e) {
            for (const tabId of tabIds) {
              try {
                await browser.tabs.remove(tabId);
              } catch (_) {}
            }
          }
        });
      }

      try {
        browser.alarms?.create(Brainer._snoozeAlarmName(snoozeId), { when: wakeAt });
      } catch (_) {}

      await Brainer.refreshTabMenu();
      await Brainer.updateBadge();

      return { success: true, snoozeId };
    } catch (e) {
      Brainer.recordError("snoozeWorkspace", e);
      return { success: false, error: e?.message ? String(e.message) : String(e) };
    }
  }

  static async snoozeTabs(message) {
    try {
      const windowId = Number(message?.windowId);
      const wakeAt = Number(message?.wakeAt);
      const activateOnWake = message?.activateOnWake === true;

      const tabIdsRaw = Array.isArray(message?.tabIds) ? message.tabIds : [];
      const tabIds = tabIdsRaw.map(Number).filter(Number.isFinite);

      if (!Number.isFinite(windowId)) {
        return { success: false, error: "Invalid windowId" };
      }
      if (tabIds.length === 0) {
        return { success: false, error: "No tabs to snooze" };
      }
      if (!Number.isFinite(wakeAt) || wakeAt <= Date.now()) {
        return { success: false, error: "Invalid wake time" };
      }

      const workspaces = await WSPStorageManger.getWorkspaces(windowId);
      const ownersByTabId = new Map();
      for (const wsp of workspaces) {
        for (const tabId of (Array.isArray(wsp.tabs) ? wsp.tabs : [])) {
          if (!ownersByTabId.has(tabId)) {
            ownersByTabId.set(tabId, wsp.id);
          }
        }
      }

      const openTabs = await browser.tabs.query({ windowId });
      const openById = new Map(openTabs.map(t => [t.id, t]));

      const entries = [];
      const existingTabIds = [];
      for (const tabId of tabIds) {
        const tab = openById.get(tabId);
        if (!tab) continue;
        if (tab.pinned) continue;

        existingTabIds.push(tabId);
        entries.push({
          url: tab.url || "",
          title: tab.title || "",
          pinned: false,
          workspaceId: ownersByTabId.get(tabId) || null
        });
      }

      if (existingTabIds.length === 0) {
        return { success: false, error: "No eligible tabs to snooze" };
      }

      // Remove the tabs from workspace state before closing them.
      const toCloseSet = new Set(existingTabIds);
      const touched = [];
      for (const wsp of workspaces) {
        const beforeTabs = Array.isArray(wsp?.tabs) ? wsp.tabs : [];
        const afterTabs = beforeTabs.filter(tabId => !toCloseSet.has(tabId));
        const changed = afterTabs.length !== beforeTabs.length;
        if (!changed) continue;

        wsp.tabs = afterTabs;
        if (Array.isArray(wsp.groups)) {
          for (const group of wsp.groups) {
            if (!Array.isArray(group.tabs)) continue;
            group.tabs = group.tabs.filter(tabId => !toCloseSet.has(tabId));
          }
          wsp.groups = wsp.groups.filter(group => Array.isArray(group.tabs) && group.tabs.length > 0);
        }
        touched.push(wsp);
      }

      for (const wsp of touched) {
        await wsp._saveState();
      }
      await WSPStorageManger.flushPending().catch(() => {});

      const snoozeId = `snooze-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const snooze = {
        id: snoozeId,
        type: "tabs",
        createdAt: Date.now(),
        wakeAt,
        payload: {
          windowId,
          tabs: entries,
          fallbackWorkspaceId: workspaces.find(w => w.active)?.id || null,
          activateOnWake,
          activateWorkspaceId: workspaces.find(w => w.active)?.id || null
        }
      };

      await WSPStorageManger.addSnooze(snooze);
      await WSPStorageManger.flushPending().catch(() => {});

      await Brainer.withSuppressedTabTracking(async () => {
        try {
          await browser.tabs.remove(existingTabIds);
        } catch (e) {
          for (const tabId of existingTabIds) {
            try {
              await browser.tabs.remove(tabId);
            } catch (_) {}
          }
        }
      });

      try {
        browser.alarms?.create(Brainer._snoozeAlarmName(snoozeId), { when: wakeAt });
      } catch (_) {}

      await Brainer.refreshTabMenu();
      await Brainer.updateBadge();

      return { success: true, snoozeId, snoozedCount: existingTabIds.length };
    } catch (e) {
      Brainer.recordError("snoozeTabs", e);
      return { success: false, error: e?.message ? String(e.message) : String(e) };
    }
  }

  static async initialize() {
    await WSPStorageManger.migrateIfNeeded().catch((e) => {
      Brainer.recordError("migrateIfNeeded", e);
      console.warn("Storage migration failed:", e);
    });
    this.registerListeners();
    this.registerCommandListeners();
    await this.refreshTabMenu();
    await this.updateBadge();

    await Brainer.autoArchiveInactiveWorkspaces().catch(() => {});
    if (!Brainer._autoArchiveInterval) {
      Brainer._autoArchiveInterval = setInterval(() => {
        Brainer.autoArchiveInactiveWorkspaces().catch(() => {});
      }, 6 * 60 * 60 * 1000);
    }

    await Brainer._syncSnoozeAlarms().catch(() => {});
  }

  static registerCommandListeners() {
    browser.commands.onCommand.addListener(async (command) => {
      const primaryWindowId = await WSPStorageManger.getPrimaryWindowId();
      if (!primaryWindowId) return;

      if (command === "move-tab-to-workspace") {
        // Store flag to indicate move mode, then open popup
        await browser.storage.local.set({ "wsp-move-tab-mode": true });
        // Open the popup - user will see workspace picker
        await browser.browserAction.openPopup();
        return;
      }

      if (command === "create-new-workspace") {
        await browser.storage.local.set({ "wsp-create-workspace-mode": true });
        browser.runtime.sendMessage({ type: "wsp-create-workspace" }).catch(() => {});
        await browser.browserAction.openPopup();
        return;
      }

      if (command === "focus-search" || command === "quick-switcher") {
        await browser.storage.local.set({ "wsp-focus-search-mode": true });
        // If the popup is already open, this can focus immediately.
        browser.runtime.sendMessage({ type: "wsp-focus-search" }).catch(() => {});
        await browser.browserAction.openPopup();
        return;
      }

      const workspaces = await Brainer.getWorkspacesInUiOrder(primaryWindowId);
      if (workspaces.length === 0) return;

      const activeIndex = workspaces.findIndex(wsp => wsp.active);
      const currentIndex = activeIndex === -1 ? 0 : activeIndex;

      if (command === "next-workspace") {
        const nextIndex = (currentIndex + 1) % workspaces.length;
        await Brainer.activateWsp(workspaces[nextIndex].id, primaryWindowId);
      } else if (command === "previous-workspace") {
        const prevIndex = (currentIndex - 1 + workspaces.length) % workspaces.length;
        await Brainer.activateWsp(workspaces[prevIndex].id, primaryWindowId);
      } else {
        const match = /^workspace-(\d)$/.exec(command);
        if (match) {
          const index = parseInt(match[1], 10) - 1;
          if (index >= 0 && index < workspaces.length) {
            await Brainer.activateWsp(workspaces[index].id, primaryWindowId);
          }
        }
      }
    });
  }

  static registerListeners() {
    // Use the static property instead of local variable for visibility from popup
    const setInitialized = (value) => { Brainer._initialized = value; };
    const isInitialized = () => Brainer._initialized;

    // initial set up when first installed
    browser.runtime.onInstalled.addListener(async (details) => {
      const currentWindow = await browser.windows.getCurrent();
      if (await WSPStorageManger.getPrimaryWindowId() == null && await WSPStorageManger.getPrimaryWindowLastId() == null) {
        await WSPStorageManger.setPrimaryWindowId(currentWindow.id);
      }

      const activeWsp = await Brainer.getActiveWsp(currentWindow.id);

      if (!activeWsp && await WSPStorageManger.getPrimaryWindowId() === currentWindow.id) {
        const currentTabs = await browser.tabs.query({windowId: currentWindow.id, pinned: false});
        const wsp = {
          id: Date.now(),
          name: Brainer.generateWspName(),
          active: true,
          tabs: [...currentTabs.map(tab => tab.id)],
          windowId: currentWindow.id
        };

        await Brainer.createWorkspace(wsp);
      }
      setInitialized(true);
    });

    async function onWindowCreated(window, isBrowserStartup = false) {
      console.log("[Foxden] onWindowCreated called, windowId:", window.id, "isBrowserStartup:", isBrowserStartup);

      const storedPrimaryWindowId = await WSPStorageManger.getPrimaryWindowId();
      const storedLastWindowId = await WSPStorageManger.getPrimaryWindowLastId();

      console.log("[Foxden] storedPrimaryWindowId:", storedPrimaryWindowId, "storedLastWindowId:", storedLastWindowId);

      // initial startup (fresh install)
      if (storedPrimaryWindowId == null && storedLastWindowId == null) {
        console.log("[Foxden] Fresh install detected");
        await WSPStorageManger.setPrimaryWindowId(window.id);

        const wsp = {
          id: Date.now(),
          name: Brainer.generateWspName(),
          active: true,
          tabs: [],
          windowId: window.id
        };

        await Brainer.createWorkspace(wsp);
        setInitialized(true);
        return;
      }

      // Browser restart - need to remap tab IDs
      // This happens when:
      // 1. primaryWindowId is null (shutdown saved primaryWindowLastId), OR
      // 2. This is a browser startup (isBrowserStartup=true) and we need to remap tabs
      const needsTabRemapping = storedPrimaryWindowId == null || isBrowserStartup;

      if (needsTabRemapping) {
        console.log("[Foxden] Browser restart detected, starting migration...");

        // Use immediate write to prevent race with popup
        await browser.storage.local.set({ "primary-window-id": window.id });

        const newTabs = await browser.tabs.query({windowId: window.id});

        // Build URL-to-new-tab-ID mapping for matching tabs after restart
        // Tab IDs change on restart, but URLs remain the same
        const urlToNewTabId = {};
        for (const tab of newTabs) {
          if (tab.url) {
            // Use the URL as key - if multiple tabs have same URL, last one wins
            // (this is rare and acceptable)
            urlToNewTabId[tab.url] = tab.id;
          }
        }
        console.log("[Foxden] URL mapping created for", Object.keys(urlToNewTabId).length, "tabs");

        // Get workspaces from the old window ID
        // If primaryWindowLastId is set (clean shutdown), use that
        // Otherwise, if this is a browser startup with same window ID, use storedPrimaryWindowId
	        const oldWindowId = storedLastWindowId || storedPrimaryWindowId;
	        console.log("[Foxden] Old window ID for migration:", oldWindowId, "(storedLastWindowId:", storedLastWindowId, "storedPrimaryWindowId:", storedPrimaryWindowId, ")");

	        if (oldWindowId == null) {
	          console.log("[Foxden] No old window ID found, skipping migration");
	          setInitialized(true);
	          return;
	        }

	        const workspaces = await WSPStorageManger.getWorkspaces(oldWindowId);
	        console.log("[Foxden] Found", workspaces.length, "workspaces to migrate from window", oldWindowId);

	        // Migrate snoozed payload windowIds to the new window on restart.
	        try {
	          const snoozes = await WSPStorageManger.getSnoozes();
	          const oldIdNum = Number(oldWindowId);
	          const newIdNum = Number(window.id);

	          let changed = false;
	          const next = (Array.isArray(snoozes) ? snoozes : []).map((s) => {
	            if (!s || typeof s !== "object") return s;
	            const payload = s.payload && typeof s.payload === "object" ? { ...s.payload } : null;
	            const payloadWin = payload?.windowId == null ? null : Number(payload.windowId);
	            if (payload && Number.isFinite(oldIdNum) && Number.isFinite(newIdNum) && payloadWin === oldIdNum) {
	              payload.windowId = newIdNum;
	              changed = true;
	              return { ...s, payload };
	            }
	            return s;
	          });

	          if (changed) {
	            await WSPStorageManger.saveSnoozes(next);
	            await WSPStorageManger.flushPending().catch(() => {});
	          }
	        } catch (_) {}

        // Only destroy old window data if the window ID actually changed
        // If Firefox reused the same window ID, we just need to update tab IDs in place
        const windowIdChanged = oldWindowId !== window.id;
        console.log("[Foxden] Window ID changed:", windowIdChanged, "(old:", oldWindowId, "new:", window.id, ")");

        if (windowIdChanged) {
	          await WSPStorageManger.destroyWindow(oldWindowId);
        }

        let activeWspId = null;
        const assignedTabIds = new Set(); // Track which tabs have been assigned to workspaces

        for (const wsp of workspaces) {
          // Remap tab IDs using URL matching
          // Each workspace stores tabUrls: { oldTabId: url }
          const tabUrls = wsp.tabUrls || {};
          const newTabIds = [];

          for (const oldTabId of wsp.tabs) {
            const url = tabUrls[oldTabId];
            if (url && urlToNewTabId[url]) {
              const newTabId = urlToNewTabId[url];
              // Only assign each tab to one workspace (first match wins)
              if (!assignedTabIds.has(newTabId)) {
                newTabIds.push(newTabId);
                assignedTabIds.add(newTabId);
              }
            }
          }

          // Remap group tab IDs using URL matching
          const newGroups = [];
          for (const group of (wsp.groups || [])) {
            const groupTabs = [];
            for (const oldTabId of (group.tabs || [])) {
              const url = tabUrls[oldTabId];
              if (url && urlToNewTabId[url]) {
                const newTabId = urlToNewTabId[url];
                if (newTabIds.includes(newTabId)) {
                  groupTabs.push(newTabId);
                }
              }
            }
            if (groupTabs.length > 0) {
              newGroups.push({
                title: group.title,
                color: group.color,
                collapsed: group.collapsed,
                tabs: groupTabs
              });
            }
          }

          // Remap lastActiveTabId using URL
          let newLastActiveTabId = null;
          if (wsp.lastActiveTabId && tabUrls[wsp.lastActiveTabId]) {
            const lastActiveUrl = tabUrls[wsp.lastActiveTabId];
            if (lastActiveUrl && urlToNewTabId[lastActiveUrl]) {
              newLastActiveTabId = urlToNewTabId[lastActiveUrl];
            }
          }

		          const newWsp = {
		            id: wsp.id,
		            name: wsp.name,
		            color: wsp.color || "",
		            pinned: wsp.pinned || false,
		            suspended: wsp.suspended || false,
		            active: wsp.active,
		            archived: !!wsp.archived,
		            snoozedUntil: wsp.snoozedUntil == null ? null : Number(wsp.snoozedUntil),
		            lastActivatedAt: Number.isFinite(Number(wsp.lastActivatedAt)) ? Number(wsp.lastActivatedAt) : Date.now(),
		            tags: Array.isArray(wsp.tags) ? wsp.tags : [],
		            tabs: newTabIds,
		            groups: newGroups,
	            windowId: window.id,
	            lastActiveTabId: newLastActiveTabId
	          };

          if (wsp.active) {
            activeWspId = wsp.id;
          }

          console.log("[Foxden] Migrating workspace:", wsp.name, "tabs:", wsp.tabs.length, "->", newTabIds.length);

          if (windowIdChanged) {
            // Window ID changed - create new workspace entry
            await Workspace.create(newWsp.id, newWsp);
          } else {
            // Window ID same - just update the workspace state with new tab IDs
            await WSPStorageManger.saveWspState(newWsp.id, newWsp);
          }
        }

        // If no workspaces were found/migrated, create a default workspace with all current tabs
        if (workspaces.length === 0) {
          console.log("[Foxden] No workspaces found to migrate, creating default workspace");
          const currentTabs = await browser.tabs.query({ windowId: window.id, pinned: false });
          const currentTabIds = currentTabs.map(tab => tab.id);

          const wspId = Date.now();
          const wsp = {
            id: wspId,
            name: Brainer.generateWspName(),
            color: "",
            pinned: false,
            suspended: false,
            active: true,
            tabs: currentTabIds,
            groups: [],
            windowId: window.id,
            lastActiveTabId: currentTabIds[0] || null
          };
          await Workspace.create(wspId, wsp);
          activeWspId = wspId;
          currentTabIds.forEach(id => assignedTabIds.add(id));
        }

        // Flush workspace changes immediately
        await WSPStorageManger.flushPending().catch(() => {});
        console.log("[Foxden] Workspace migration complete, flushed to storage");
        console.log("[Foxden] Assigned", assignedTabIds.size, "tabs to workspaces");

        // Add any unassigned tabs to the active workspace
        let unassignedCount = 0;
        for (const tab of newTabs) {
          if (!tab.pinned && !assignedTabIds.has(tab.id)) {
            // This tab wasn't matched to any workspace - add to active workspace
            if (await Brainer.addTabToWorkspace(tab)) {
              await browser.tabs.show(tab.id);
              unassignedCount++;
            }
          }
        }
        if (unassignedCount > 0) {
          console.log("[Foxden] Added", unassignedCount, "unassigned tabs to active workspace");
        }

        // Properly restore workspace state - hide inactive workspace tabs
        if (activeWspId) {
          await Brainer.hideInactiveWspTabs(window.id);
          // Re-activate the active workspace to restore tab groups
          const activeWsp = await WSPStorageManger.getWorkspace(activeWspId);
          if (activeWsp && activeWsp.tabs.length > 0) {
            // Show active workspace tabs and restore groups
            await browser.tabs.show(activeWsp.tabs);
            for (const group of activeWsp.groups) {
              if (group.tabs.length > 0) {
                try {
                  const groupId = await browser.tabs.group({tabIds: group.tabs});
                  await browser.tabGroups.update(groupId, {
                    title: group.title,
                    color: group.color,
                    collapsed: group.collapsed
                  });
                } catch (e) {
                  console.warn("Could not restore tab group:", e);
                }
              }
            }
          }
        }

        await Brainer.reconcileWorkspaces(window.id, { force: true }).catch(() => {});
        await Brainer.updateTabList();
        await Brainer.updateBadge();
        setInitialized(true);
      }
    }

    browser.windows.onCreated.addListener(async (window) => {
      await onWindowCreated(window);
    });

    browser.runtime.onStartup.addListener(async () => {
      console.log("[Foxden] runtime.onStartup fired - browser is starting");
      const windowsOnLoad = await browser.windows.getAll();
      if (windowsOnLoad.length === 1) {
        await onWindowCreated(windowsOnLoad[0], true); // true = isBrowserStartup
      }
    });

    browser.windows.onRemoved.addListener(async (windowId) => {
      console.log("[Foxden] Window removed:", windowId);
      const primaryWindowId = await WSPStorageManger.getPrimaryWindowId();
      console.log("[Foxden] primaryWindowId in storage:", primaryWindowId);

      const remainingWindows = await browser.windows.getAll({ windowTypes: ["normal"] }).catch(() => []);
      const isLastWindow = !Array.isArray(remainingWindows) || remainingWindows.length === 0;

      console.log("[Foxden] Remaining windows:", remainingWindows.length, "isLastWindow:", isLastWindow);

      // If this isn't the primary window AND there are other windows, just ignore
      if (primaryWindowId !== windowId && !isLastWindow) {
        console.log("[Foxden] Non-primary window closed, other windows remain - skipping");
        return;
      }

      // If there are still windows open, promote one of them to primary
      if (!isLastWindow) {
        const lastFocused = await browser.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null);
        const newPrimaryId = lastFocused?.id || remainingWindows[0]?.id;
        if (newPrimaryId) {
          await Brainer.rebindPrimaryWindow(primaryWindowId || windowId, newPrimaryId);
          setInitialized(true);
          return;
        }
      }

      // No other windows: treat as shutdown/restart and migrate on next window creation.
      // CRITICAL: Use immediate writes that bypass the queue to ensure data is persisted
      // before browser shuts down. The queued/delayed flush may not complete in time.
      // Save the primaryWindowId (where workspaces are stored), not necessarily the closing window ID
      const windowIdToSave = primaryWindowId || windowId;
      console.log("[Foxden] Last window closing, saving primaryWindowLastId:", windowIdToSave);
      await WSPStorageManger.removePrimaryWindowIdImmediate();
      await WSPStorageManger.setPrimaryWindowLastIdImmediate(windowIdToSave);
      console.log("[Foxden] Shutdown data saved successfully");
      setInitialized(false);
    });

    browser.windows.onFocusChanged.addListener(async (windowId) => {
      if (windowId !== browser.windows.WINDOW_ID_NONE) {
        await this.refreshTabMenu();
      }
    });

	    browser.tabs.onCreated.addListener(async (tab) => {
	      if (!isInitialized()) { // make sure to don't catch up tabs during startup
	        return;
	      }
	      await Brainer.updateTabList();
	      if (Brainer._isTabTrackingSuppressed()) {
	        return;
	      }
	      if (await WSPStorageManger.getPrimaryWindowId() !== tab.windowId || tab.pinned) {
	        return;
	      }
	      await Brainer.addTabToWorkspace(tab);
	      Brainer._trackTabForRules(tab.id);
	      await Brainer.applyWorkspaceRulesIfNeeded(tab).catch(() => {});
	    });

    // Store tab info before removal for recently closed feature
    const pendingTabRemovals = new Map();

	    browser.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
	      Brainer._untrackTabForRules(tabId);
	      if (await WSPStorageManger.getPrimaryWindowId() !== removeInfo.windowId) {
	        return;
	      }
	      if (removeInfo.isWindowClosing) {
	        return;
      }

      // Get stored tab info
      const tabInfo = pendingTabRemovals.get(tabId);
      pendingTabRemovals.delete(tabId);

      await Brainer.updateTabList(tabId);
      await Brainer.removeTabFromWorkspace(removeInfo.windowId, tabId, tabInfo);
    });

	    // Capture tab info before it's removed
	    browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
	      // Store tab info for recently closed feature
	      if (tab.url && tab.title) {
	        pendingTabRemovals.set(tabId, { url: tab.url, title: tab.title });
	      }
	    });

	    // Apply workspace rules to newly created tabs once URL/title are available.
	    browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
	      if (!Brainer._ruleCandidateTabs.has(tabId)) {
	        return;
	      }
	      if (Brainer._isTabTrackingSuppressed()) {
	        return;
	      }
	      if (await WSPStorageManger.getPrimaryWindowId() !== tab.windowId || tab.pinned) {
	        Brainer._untrackTabForRules(tabId);
	        return;
	      }
	      await Brainer.applyWorkspaceRulesIfNeeded(tab, changeInfo).catch(() => {});
	    }, { properties: ["url", "title", "status"] });

    browser.tabs.onActivated.addListener(async (activeInfo) => {
      if (Brainer._isTabTrackingSuppressed()) {
        return;
      }
      if (await WSPStorageManger.getPrimaryWindowId() !== activeInfo.windowId) {
        return;
      }

      const workspaces = await WSPStorageManger.getWorkspaces(activeInfo.windowId);
      const activeWsp = workspaces.find(wsp => wsp.active);

      if (!activeWsp || activeWsp.tabs.includes(activeInfo.tabId)) {
        return;
      }

      for (const workspace of workspaces) {
        if (workspace.tabs.includes(activeInfo.tabId)) {
          console.log("Activated tab is not in the active workspace, activating workspace", workspace.name);
          await Brainer.activateWsp(workspace.id, activeInfo.windowId, activeInfo.tabId);
          return;
        }
      }


    });

    browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (await WSPStorageManger.getPrimaryWindowId() !== tab.windowId) {
        return;
      }
      if (tab.pinned) {
        await Brainer.removeTabFromWorkspace(tab.windowId, tabId);
      } else {
        await Brainer.addTabToWorkspace(tab);
      }
    }, {properties: ["pinned"]});

    browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (await WSPStorageManger.getPrimaryWindowId() !== tab.windowId) {
        return;
      }
      if (!tab.hidden) {
        const activeWsp = await Brainer.getActiveWsp(tab.windowId);
        await activeWsp.updateTabGroups();
      }
    }, {properties: ["groupId"]});

	    browser.tabGroups.onUpdated.addListener(async (group) => {
	      if (await WSPStorageManger.getPrimaryWindowId() !== group.windowId) {
	        return;
	      }

	      const activeWsp = await Brainer.getActiveWsp(group.windowId);
	      if (activeWsp) {
	        await activeWsp.updateTabGroups();
	      }
	    });

	    if (browser?.alarms?.onAlarm) {
	      browser.alarms.onAlarm.addListener(async (alarm) => {
	        const name = (alarm?.name || "").toString();
	        if (!name.startsWith("wsp-snooze:")) return;
	        const id = name.slice("wsp-snooze:".length);
	        await Brainer._wakeSnoozeById(id).catch((e) => Brainer.recordError("alarms:onAlarm", e));
	      });
	    }

	  }

  static async updateTabList(excludeTabId = null) {
    try {
      const tabs = await browser.tabs.query({windowId: await WSPStorageManger.getPrimaryWindowId()});

      if (excludeTabId && tabs.findIndex(tab => tab.id === excludeTabId) >= 0) {
        // sometimes the tab is not yet removed from the list, so we wait a bit
        setTimeout(async () => {
          await Brainer.updateTabList(excludeTabId);
        }, 100);
        return;
      }

      const currentTabs = tabs.map(tab => ({
        id: tab.id,
        index: tab.index,
      }));
      await WSPStorageManger.saveWindowTabIndexMapping(currentTabs);
    } catch (e) {
      console.error("Error updating tab list", e);
    }
  }

  static async addTabToWorkspace(tab) {
    const workspaces = await WSPStorageManger.getWorkspaces(tab.windowId);
    const activeWsp = workspaces.find(wsp => wsp.active);

    if (activeWsp) {
      if (!workspaces.find(wsp => wsp.tabs.includes(tab.id))) {
        activeWsp.tabs.push(tab.id);
        await activeWsp._saveState();
        await this.refreshTabMenu();
        return true;
      }
    } else {
      // if there is no active workspace, we create a new one
      const wsp = {
        id: Date.now(),
        name: Brainer.generateWspName(),
        active: true,
        tabs: [tab.id],
        windowId: tab.windowId
      };
      await Brainer.createWorkspace(wsp);
    }
    return false;
  }

  static async removeTabFromWorkspace(windowId, tabId, tabInfo = null) {
    const workspaces = await WSPStorageManger.getWorkspaces(windowId);
    const workspace = workspaces.find(wsp => Array.isArray(wsp.tabs) && wsp.tabs.includes(tabId));

    if (!workspace) {
      return;
    }

    // Save to recently closed if we have tab info
    if (tabInfo?.url && !tabInfo.url.startsWith("about:")) {
      await WSPStorageManger.addRecentlyClosed(workspace.id, {
        url: tabInfo.url,
        title: tabInfo.title || tabInfo.url
      });
    }

    const removedTabIdx = workspace.tabs.indexOf(tabId);
    if (removedTabIdx >= 0) {
      workspace.tabs.splice(removedTabIdx, 1);
    }

    if (Array.isArray(workspace.groups)) {
      for (const group of workspace.groups) {
        if (!Array.isArray(group.tabs)) continue;
        const tabIdx = group.tabs.indexOf(tabId);
        if (tabIdx >= 0) {
          group.tabs.splice(tabIdx, 1);
        }
      }
      // Drop empty groups
      workspace.groups = workspace.groups.filter(group => Array.isArray(group.tabs) && group.tabs.length > 0);
    }

    await workspace._saveState();

    if (workspace.tabs.length === 0) {
      try {
        const settings = await WSPStorageManger.getSettings();
        if (settings?.autoDeleteEmptyWorkspaces && !workspace.pinned) {
          const wasActive = workspace.active;
          await WSPStorageManger.deleteWspState(workspace.id);
          await WSPStorageManger.removeWsp(workspace.id, windowId);

          await this.refreshTabMenu();

          if (wasActive) {
            const remaining = await Brainer.getWorkspacesInUiOrder(windowId);
            if (remaining.length > 0) {
              await Brainer.activateWsp(remaining[0].id, windowId);
            } else {
              const newWspId = Date.now();
              await Brainer.createWorkspace({
                id: newWspId,
                name: Brainer.generateWspName(),
                active: true,
                tabs: [],
                windowId
              });
              await Brainer.activateWsp(newWspId, windowId);
            }
          } else {
            await this.updateBadge();
          }
          return;
        }
      } catch (e) {
        console.warn("Error applying auto-delete setting:", e);
      }
    }

    await this.refreshTabMenu();

    if (workspace.active) {
      await this.updateBadge();
    }
  }

  static async initializeTabMenu() {
    const currentWindow = await browser.windows.getCurrent();

    if (await WSPStorageManger.getPrimaryWindowId() !== currentWindow.id) {
      return;
    }

    const workspaces = await Brainer.getWorkspacesInUiOrder(currentWindow.id);

    const menuId = `ld-wsp-manager-menu-${currentWindow.id}-${Date.now()}-id`;

    browser.menus.create({
      id: menuId,
      title: "Move Tab to Another Workspace",
      enabled: workspaces.length > 1,
      contexts: ["tab"]
    });

    let currentWsp = null;

    for (const workspace of workspaces) {
      if (workspace.active) {
        currentWsp = workspace;
      }

      browser.menus.create({
        title: `${workspace.name} (${workspace.tabs.length} tabs)`,
        parentId: menuId,
        id: `sub-menu-${Date.now()}-${workspace.id}-id`,
        enabled: !workspace.active,
        onclick: async (info, tab) => {
          // Get all highlighted tabs in the current window
          const highlightedTabs = await browser.tabs.query({
            currentWindow: true,
            highlighted: true
          });

          const tabsToMove = highlightedTabs.length > 1 && highlightedTabs.some(t => t.id === tab.id)
            ? highlightedTabs
            : [tab]; // fallback to single right-clicked tab

          // Move each selected tab to the target workspace
          for (const t of tabsToMove) {
            await Brainer.moveTabToWsp(t, currentWsp.id, workspace.id);
          }
        }
      });
    }
  }

  static async getWorkspaces(windowId) {
    await Brainer.reconcileWorkspaces(windowId).catch(() => {});
    return await Workspace.getWorkspaces(windowId);
  }

  static async createWorkspace(wsp) {
    if (wsp.active) {
      // make other workspaces inactive first
      await Brainer.setCurrentWspDisabled(wsp.windowId);
    }

    const w = await Workspace.create(wsp.id, wsp);
    if (wsp.active) {
      await w.updateTabGroups();
    }

    // Flush storage immediately to ensure workspace is persisted
    // This is critical for import operations and prevents data loss on browser close
    await WSPStorageManger.flushPending().catch(() => {});

    await this.refreshTabMenu();
    await this.updateBadge();
  }

  static async renameWorkspace(wspId, wspName) {
    await Workspace.rename(wspId, wspName);

    await this.refreshTabMenu();
    await this.updateBadge();
  }

  static async getNumWorkspaces(windowId) {
    return WSPStorageManger.getNumWorkspaces(windowId);
  }

  static async hideInactiveWspTabs(windowId) {
    const workspaces = await WSPStorageManger.getWorkspaces(windowId);
    for (const wsp of workspaces) {
      if (!wsp.active) {
        await wsp.hideTabs();
      }
    }
  }

  static async getActiveWsp(windowId) {
    const workspaces = await WSPStorageManger.getWorkspaces(windowId);
    return workspaces.find(wsp => wsp.active);
  }

  static async destroyWsp(wspId) {
    const wsp = await WSPStorageManger.getWorkspace(wspId);
    await wsp.destroy();
    await this.refreshTabMenu();
  }

  static async setCurrentWspDisabled(windowId) {
    const workspaces = await WSPStorageManger.getWorkspaces(windowId);
    const activeWsp = workspaces.find(wsp => wsp.active);

    if (activeWsp) {
      // check if there are currently visible tabs which do not belong to any workspace. If yes, add them to the active workspace.
      const currentTabs = await browser.tabs.query({windowId, pinned: false});
      const currentTabIds = currentTabs.map(tab => tab.id);
      const tabsToAdd = currentTabIds.filter(tabId => workspaces.every(wsp => !wsp.tabs.includes(tabId)));
      if (tabsToAdd.length > 0) {
        console.log(`Adding ${tabsToAdd.length} untracked tabs to the active workspace`);
        activeWsp.tabs.unshift(...tabsToAdd);
        await activeWsp.updateTabGroups();
      }

      activeWsp.active = false;
      activeWsp.lastActiveTabId = (await browser.tabs.query({ windowId, active: true }))[0]?.id || null;
      await activeWsp._saveState();
    }
  }

  static _uniqueTabIds(tabIds) {
    const input = Array.isArray(tabIds) ? tabIds : [];
    const out = [];
    const seen = new Set();

    for (const raw of input) {
      const id = Number(raw);
      if (!Number.isFinite(id)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }

    return out;
  }

  static _sleep(ms) {
    const delay = Number(ms);
    return new Promise(resolve => setTimeout(resolve, Number.isFinite(delay) ? delay : 0));
  }

  static _isPermanentTabError(error) {
    const msg = (error?.message ? String(error.message) : String(error)).toLowerCase();

    return (
      msg.includes("invalid tab") ||
      msg.includes("tab not found") ||
      msg.includes("does not exist") ||
      msg.includes("invalid argument")
    );
  }

  static async _retryTransient(fn, { retries = 2, delayMs = 40, context = "" } = {}) {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (e) {
        attempt++;
        const permanent = Brainer._isPermanentTabError(e);
        if (permanent || attempt > retries) {
          if (context) {
            Brainer.recordError(context, e);
          }
          throw e;
        }
        await Brainer._sleep(delayMs * attempt);
      }
    }
  }

  static async _safeTabsShow(tabIds) {
    const ids = Brainer._uniqueTabIds(tabIds);
    if (ids.length === 0) return;

    try {
      await Brainer._retryTransient(() => browser.tabs.show(ids), { retries: 1, delayMs: 40 });
      return;
    } catch (e) {
      // Fall back to per-tab to avoid one bad ID failing the whole batch.
    }

    let lastError = null;
    for (const id of ids) {
      try {
        await Brainer._retryTransient(() => browser.tabs.show(id), { retries: 1, delayMs: 40 });
      } catch (e) {
        lastError = e;
      }
    }
    if (lastError) {
      Brainer.recordError("tabs.show", lastError);
    }
  }

  static async _safeTabsHide(tabIds) {
    const ids = Brainer._uniqueTabIds(tabIds);
    if (ids.length === 0) return;

    try {
      await Brainer._retryTransient(() => browser.tabs.hide(ids), { retries: 1, delayMs: 40 });
      return;
    } catch (e) {
      // Fall back to per-tab to avoid one bad ID failing the whole batch.
    }

    let lastError = null;
    for (const id of ids) {
      try {
        await Brainer._retryTransient(() => browser.tabs.hide(id), { retries: 1, delayMs: 40 });
      } catch (e) {
        lastError = e;
      }
    }
    if (lastError) {
      Brainer.recordError("tabs.hide", lastError);
    }
  }

  static async _safeTabsUngroup(tabIds) {
    const ids = Brainer._uniqueTabIds(tabIds);
    if (ids.length === 0) return;

    try {
      await Brainer._retryTransient(() => browser.tabs.ungroup(ids), { retries: 1, delayMs: 40 });
      return;
    } catch (e) {
      // Fall back to per-tab to avoid one bad ID failing the whole batch.
    }

    let lastError = null;
    for (const id of ids) {
      try {
        await Brainer._retryTransient(() => browser.tabs.ungroup(id), { retries: 1, delayMs: 40 });
      } catch (e) {
        lastError = e;
      }
    }
    if (lastError) {
      Brainer.recordError("tabs.ungroup", lastError);
    }
  }

  static async _safeActivateTab(tabId) {
    const id = Number(tabId);
    if (!Number.isFinite(id)) return false;

    try {
      await Brainer._retryTransient(() => browser.tabs.update(id, { active: true }), { retries: 1, delayMs: 40 });
      return true;
    } catch (e) {
      Brainer.recordError("tabs.update(active)", e);
      return false;
    }
  }

  static async _restoreWorkspaceGroups(workspace, allowedTabIds) {
    const allowed = allowedTabIds instanceof Set ? allowedTabIds : new Set(allowedTabIds || []);
    const groups = Array.isArray(workspace?.groups) ? workspace.groups : [];

    for (const group of groups) {
      const tabIds = Brainer._uniqueTabIds(group?.tabs).filter(id => allowed.has(id));
      if (tabIds.length === 0) continue;

      try {
        const groupId = await Brainer._retryTransient(() => browser.tabs.group({ tabIds }), { retries: 1, delayMs: 60 });
        const updates = {
          title: typeof group?.title === "string" ? group.title : "",
          collapsed: !!group?.collapsed,
        };
        if (typeof group?.color === "string" && group.color.length > 0) {
          updates.color = group.color;
        }
        await Brainer._retryTransient(() => browser.tabGroups.update(groupId, updates), { retries: 1, delayMs: 60 });
      } catch (e) {
        Brainer.recordError("tabGroups.restore", e);
        // Best-effort; continue restoring other groups.
      }
    }
  }

  static async _ensureWorkspaceHasTab(workspace, windowId, pinnedTabIds) {
    const pinned = pinnedTabIds instanceof Set ? pinnedTabIds : new Set(pinnedTabIds || []);
    workspace.tabs = Brainer._uniqueTabIds(workspace?.tabs).filter(id => !pinned.has(id));

    if (workspace.tabs.length > 0) {
      return { created: false };
    }

    const newTab = await browser.tabs.create({
      windowId,
      active: true,
    });

    workspace.tabs = [newTab.id];
    workspace.lastActiveTabId = newTab.id;
    return { created: true, tabId: newTab.id };
  }

  static async _enforceWorkspaceView(windowId, workspace, activeTabId = null) {
    const readTabs = async () => await browser.tabs.query({ windowId });

    let allTabs = await readTabs();
    let openTabIds = new Set(allTabs.map(tab => tab.id));
    let pinnedTabIds = new Set(allTabs.filter(tab => tab.pinned).map(tab => tab.id));

    // Keep workspace tab IDs valid and unpinned
    workspace.tabs = Brainer._uniqueTabIds(workspace?.tabs).filter(id => openTabIds.has(id) && !pinnedTabIds.has(id));

    // Ensure there is at least one workspace tab to show/activate
    if (workspace.tabs.length === 0) {
      await Brainer._ensureWorkspaceHasTab(workspace, windowId, pinnedTabIds);

      // Refresh tab snapshot after creation.
      allTabs = await readTabs();
      openTabIds = new Set(allTabs.map(tab => tab.id));
      pinnedTabIds = new Set(allTabs.filter(tab => tab.pinned).map(tab => tab.id));
      workspace.tabs = Brainer._uniqueTabIds(workspace.tabs).filter(id => openTabIds.has(id) && !pinnedTabIds.has(id));
    }

    const targetTabIds = workspace.tabs;
    const targetSet = new Set(targetTabIds);

    // Show target workspace tabs first (so we don't end up with an empty tab strip)
    await Brainer._safeTabsShow(targetTabIds);

    // Determine which tab to activate
    const requested = Number(activeTabId);
    const lastActive = Number(workspace?.lastActiveTabId);
    let tabToActivate = null;

    if (Number.isFinite(requested) && (targetSet.has(requested) || pinnedTabIds.has(requested))) {
      tabToActivate = requested;
    } else if (Number.isFinite(lastActive) && (targetSet.has(lastActive) || pinnedTabIds.has(lastActive))) {
      tabToActivate = lastActive;
    } else if (targetTabIds.length > 0) {
      tabToActivate = targetTabIds[0];
    }

    // IMPORTANT: Activate a tab in the target workspace BEFORE hiding other tabs.
    // Firefox won't hide the currently active tab, so we must switch focus first.
    if (tabToActivate != null) {
      const ok = await Brainer._safeActivateTab(tabToActivate);
      if (!ok && targetTabIds.length > 0) {
        await Brainer._safeActivateTab(targetTabIds[0]);
      }
    }

    // Now hide every other unpinned tab in the window (including untracked ones)
    const unpinnedTabIds = allTabs.filter(tab => !tab.pinned).map(tab => tab.id);
    const tabIdsToHide = unpinnedTabIds.filter(id => !targetSet.has(id));

    await Brainer._safeTabsHide(tabIdsToHide);
    await Brainer._safeTabsUngroup(tabIdsToHide);

    // Reset + restore groups for the target workspace
    await Brainer._safeTabsUngroup(targetTabIds);
    await Brainer._restoreWorkspaceGroups(workspace, targetSet);

    return { targetTabIds };
  }

  static async activateWsp(wspId, windowId, activeTabId = null) {
    const key = String(windowId);
    const previous = Brainer._activateQueueByWindow.get(key) || Promise.resolve();

    const next = previous
      .catch(() => {})
      .then(async () => {
        const settings = await WSPStorageManger.getSettings();
        const debug = !!settings?.debug;
        const label = `wsp:activate:${windowId}:${wspId}`;
        if (debug) console.time(label);

        try {
          const winId = Number(windowId);
          if (!Number.isFinite(winId)) {
            throw new Error("Invalid windowId");
          }

          // Keep state clean before switching.
          await Brainer.reconcileWorkspaces(winId, { force: true, throttleMs: 0 }).catch(() => {});

          await Brainer.withSuppressedTabTracking(async () => {
            const workspaces = await WSPStorageManger.getWorkspaces(winId);
            const target = workspaces.find(w => String(w.id) === String(wspId));

            if (!target) {
              throw new Error("Workspace not found");
            }

            const currentActiveTabId = (await browser.tabs.query({ windowId: winId, active: true }))[0]?.id || null;
            const previousActive = workspaces.find(w => w.active && String(w.id) !== String(target.id)) || null;

            if (previousActive) {
              // Add visible untracked tabs to the workspace we're deactivating.
              try {
                const currentTabs = await browser.tabs.query({ windowId: winId, pinned: false });
                const visibleTabIds = currentTabs.filter(tab => !tab.hidden).map(tab => tab.id);
                const tabsToAdd = visibleTabIds.filter(tabId => workspaces.every(w => !w.tabs.includes(tabId)));
                if (tabsToAdd.length > 0) {
                  previousActive.tabs.unshift(...tabsToAdd);
                  await previousActive.updateTabGroups().catch(() => {});
                }
              } catch (e) {
                // Best-effort only.
              }

              previousActive.lastActiveTabId = currentActiveTabId;
              await previousActive._saveState();
            }

            // Enforce actual tab visibility/groups first, then commit active flags to storage.
            if (target.windowId !== winId) {
              target.windowId = winId;
            }

            // Clear suspended state when activating
            if (target.suspended) {
              target.suspended = false;
            }

            // Activation implies the workspace is no longer archived.
            target.archived = false;
            target.lastActivatedAt = Date.now();

            await Brainer._enforceWorkspaceView(winId, target, activeTabId);

            // Commit: exactly one active workspace in storage.
            for (const wsp of workspaces) {
              const isTarget = String(wsp.id) === String(target.id);
              wsp.active = isTarget;
              if (wsp.windowId !== winId) {
                wsp.windowId = winId;
              }
              if (isTarget && wsp.suspended) {
                wsp.suspended = false;
              }
              await wsp._saveState();
            }

            await WSPStorageManger.flushPending().catch(() => {});
          });

          await this.refreshTabMenu();
          await this.updateBadge();
        } catch (e) {
          Brainer.recordError("activateWsp", e);
          throw e;
        } finally {
          if (debug) console.timeEnd(label);
        }
      });

    Brainer._activateQueueByWindow.set(key, next.catch(() => {}));
    return await next;
  }

  static generateWspName() {
    return 'Unnamed Workspace';
  }

  static async refreshTabMenu() {
    await browser.menus.removeAll();
    await Brainer.initializeTabMenu();
  }

  static async updateBadge() {
    try {
      const primaryWindowId = await WSPStorageManger.getPrimaryWindowId();
      if (!primaryWindowId) {
        await browser.browserAction.setBadgeText({ text: "" });
        return;
      }

      const activeWsp = await Brainer.getActiveWsp(primaryWindowId);
      if (!activeWsp) {
        await browser.browserAction.setBadgeText({ text: "" });
        await browser.browserAction.setTitle({ title: "Foxden" });
        return;
      }

      // Set badge text (first 2 characters of workspace name)
      const badgeText = activeWsp.name.substring(0, 2).toUpperCase();
      await browser.browserAction.setBadgeText({ text: badgeText });

      // Set badge background color (use workspace color or default)
      const badgeColor = activeWsp.color || "#666666";
      await browser.browserAction.setBadgeBackgroundColor({ color: badgeColor });

      // Set tooltip with full workspace info
      const tabCount = activeWsp.tabs.length;
      const tabText = tabCount === 1 ? "1 tab" : `${tabCount} tabs`;
      await browser.browserAction.setTitle({
        title: `Foxden - ${activeWsp.name} (${tabText})`
      });
    } catch (e) {
      console.warn("Error updating badge:", e);
    }
  }

  static async duplicateWorkspace(wspId, windowId) {
    return await Brainer.withSuppressedTabTracking(async () => {
      const originalWsp = await WSPStorageManger.getWorkspace(wspId);
      const newWspId = Date.now();

      const tabIdMapping = new Map();
      const newTabIds = [];

      for (const tabId of originalWsp.tabs) {
        try {
          const tab = await browser.tabs.get(tabId);
          const url = tab.url;

          // Skip about: and other restricted URLs
          if (!url || url.startsWith("about:") || url.startsWith("chrome:") || url.startsWith("moz-extension:")) {
            continue;
          }

          const newTab = await browser.tabs.create({
            url,
            active: false,
            windowId
          });

          newTabIds.push(newTab.id);
          tabIdMapping.set(tabId, newTab.id);
        } catch (e) {
          // Tab may no longer exist or cannot be duplicated
        }
      }

      // Re-map tab groups using the newly created tab IDs
      const newGroups = [];
      if (Array.isArray(originalWsp.groups)) {
        for (const group of originalWsp.groups) {
          const mappedTabIds = (group.tabs || [])
            .map(tabId => tabIdMapping.get(tabId))
            .filter(Boolean);

          if (mappedTabIds.length === 0) continue;

          newGroups.push({
            title: group.title || "",
            color: group.color,
            collapsed: !!group.collapsed,
            tabs: mappedTabIds
          });
        }
      }

      // Hide duplicated tabs so the new workspace is inactive
      if (newTabIds.length > 0) {
        try {
          await browser.tabs.hide(newTabIds);
        } catch (e) {
          // Tabs may not be ready yet
        }
      }

      // Create the new workspace
      const newWsp = {
        id: newWspId,
        name: `${originalWsp.name} (Copy)`,
        color: originalWsp.color || "",
        pinned: originalWsp.pinned || false,
        suspended: false,
        active: false,
        archived: false,
        lastActivatedAt: Date.now(),
        tags: Array.isArray(originalWsp.tags) ? originalWsp.tags : [],
        tabs: newTabIds,
        groups: newGroups,
        windowId: windowId
      };

      await Workspace.create(newWspId, newWsp);
      await Brainer.refreshTabMenu();

      return { workspace: newWsp };
    });
  }

  static async suspendWorkspace(wspId) {
    const wsp = await WSPStorageManger.getWorkspace(wspId);

    // Don't suspend active workspace
    if (wsp.active) {
      return { success: false, error: "Cannot suspend active workspace" };
    }

    let discardedCount = 0;
    for (const tabId of wsp.tabs) {
      try {
        await browser.tabs.discard(tabId);
        discardedCount++;
      } catch (e) {
        // Tab may not exist or already discarded
      }
    }

    // Mark workspace as suspended
    await Workspace.update(wspId, { suspended: true });

    return { success: true, discardedCount };
  }

  static async unsuspendWorkspace(wspId) {
    // Just mark as not suspended - tabs will reload when clicked
    await Workspace.update(wspId, { suspended: false });
    return { success: true };
  }

  static async createFromTemplate(templateId, windowId) {
    const templates = await WSPStorageManger.getTemplates();
    const template = templates.find(t => t.id === templateId);

    if (!template) {
      return { success: false, error: "Template not found" };
    }

    // Deactivate current workspace
    await Brainer.setCurrentWspDisabled(windowId);

    // Create tabs for the new workspace
    const { newTabIdsByIndex, newTabIds } = await Brainer.withSuppressedTabTracking(async () => {
      const newTabIdsByIndex = [];
      for (const tabData of (template.tabs || [])) {
        const url = tabData?.url;
        if (!url || url.startsWith("about:") || url.startsWith("chrome:") || url.startsWith("moz-extension:")) {
          newTabIdsByIndex.push(null);
          continue;
        }

        try {
          const newTab = await browser.tabs.create({
            url,
            active: false,
            windowId
          });
          newTabIdsByIndex.push(newTab.id);
        } catch (e) {
          newTabIdsByIndex.push(null);
        }
      }

      let newTabIds = newTabIdsByIndex.filter(Boolean);

      // Ensure the workspace has at least one tab
      if (newTabIds.length === 0) {
        const blankTab = await browser.tabs.create({ active: true, windowId });
        newTabIds = [blankTab.id];
      }

      return { newTabIdsByIndex, newTabIds };
    });

    // Re-map template groups (stored as indices) to new tab IDs
    const groups = [];
    for (const group of (template.groups || [])) {
      const indices = Array.isArray(group.tabIndices) ? group.tabIndices : (Array.isArray(group.tabs) ? group.tabs : []);
      const tabIds = indices
        .filter(i => Number.isInteger(i) && i >= 0 && i < newTabIdsByIndex.length)
        .map(i => newTabIdsByIndex[i])
        .filter(Boolean);

      if (tabIds.length === 0) continue;

      groups.push({
        title: group.title || group.name || "",
        color: group.color,
        collapsed: !!group.collapsed,
        tabs: tabIds
      });
    }

    // Create the workspace
    const wspId = Date.now();
    const wsp = {
      id: wspId,
      name: template.name,
      color: template.color || "",
      active: true,
      tabs: newTabIds,
      groups,
      windowId: windowId
    };

    const workspace = await Workspace.create(wspId, wsp);

    // Apply groups in Firefox (workspace is active)
    for (const group of groups) {
      if (group.tabs.length === 0) continue;
      try {
        const groupId = await browser.tabs.group({ tabIds: group.tabs });
        await browser.tabGroups.update(groupId, {
          title: group.title,
          color: group.color,
          collapsed: group.collapsed
        });
      } catch (e) {
        console.warn("Could not create tab group from template:", e);
      }
    }

    // Persist the group structure
    await workspace.updateTabGroups();

    // Activate the first tab, or create a blank one if none
    await browser.tabs.update(newTabIds[0], { active: true });

    await Brainer.hideInactiveWspTabs(windowId);
    await this.refreshTabMenu();
    await this.updateBadge();

    return { success: true, workspace: wsp };
  }

  static async restoreRecentlyClosed(wspId, index) {
    const closedTabs = await WSPStorageManger.getRecentlyClosed(wspId);
    if (index < 0 || index >= closedTabs.length) {
      return { success: false, error: "Invalid index" };
    }

    const tabData = closedTabs[index];
    const wsp = await WSPStorageManger.getWorkspace(wspId);

    try {
      // Create new tab with the URL
      const newTab = await Brainer.withSuppressedTabTracking(async () => {
        return await browser.tabs.create({
          url: tabData.url,
          active: wsp.active,
          windowId: wsp.windowId
        });
      });

      // Add to workspace
      wsp.tabs.push(newTab.id);
      await wsp._saveState();

      // Hide if workspace is not active
      if (!wsp.active) {
        await browser.tabs.hide(newTab.id);
      }

      // Remove from recently closed
      await WSPStorageManger.removeRecentlyClosed(wspId, index);

      await this.refreshTabMenu();
      if (wsp.active) {
        await this.updateBadge();
      }
      return { success: true, tabId: newTab.id };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  static async moveTabToWsp(tab, fromWspId, toWspId) {
    const tabId = tab.id;
    const fromWsp = await WSPStorageManger.getWorkspace(fromWspId);
    const toWsp = await WSPStorageManger.getWorkspace(toWspId);

    // add movedTabId to the toWsp workspace
    toWsp.tabs.unshift(tabId);
    await toWsp._saveState();

    const movedTabIdx = fromWsp.tabs.findIndex(tId => tId === tabId);

    if (movedTabIdx >= 0) {
      fromWsp.tabs.splice(movedTabIdx, 1);

      for (const group of fromWsp.groups) {
        const tabIdx = group.tabs.indexOf(tabId);
        if (tabIdx >= 0) {
          group.tabs.splice(tabIdx, 1);
        }
      }
      fromWsp.groups = fromWsp.groups.filter(group => Array.isArray(group.tabs) && group.tabs.length > 0);
      await fromWsp._saveState();

      if (tab.active) {
        await Brainer.activateWsp(toWspId, toWsp.windowId, tabId);
      } else {
        await Brainer.hideInactiveWspTabs(toWsp.windowId);
      }

      await browser.tabs.ungroup([tabId]);
    }

    await this.refreshTabMenu();
    await this.updateBadge();
  }

  static async collectTabsByDomain(message) {
    const windowId = Number(message?.windowId);
    const toWspId = Number(message?.toWspId);
    const includeSubdomains = message?.includeSubdomains !== false;

    if (!Number.isFinite(windowId)) {
      return { success: false, error: "Invalid windowId" };
    }
    if (!Number.isFinite(toWspId)) {
      return { success: false, error: "Invalid toWspId" };
    }

    const rawDomain = (message?.domain || "").toString().trim();

    const normalizeDomain = (value) => {
      const raw = (value || "").toString().trim().toLowerCase();
      if (raw.length === 0) return null;

      try {
        if (raw.includes("://")) {
          return new URL(raw).hostname.replace(/^www\./, "");
        }
        return new URL(`https://${raw}`).hostname.replace(/^www\./, "");
      } catch (_) {
        return null;
      }
    };

    const domain = normalizeDomain(rawDomain);
    if (!domain) {
      return { success: false, error: "Invalid domain" };
    }

    const matchesDomain = (url) => {
      const rawUrl = (url || "").toString();
      if (rawUrl.length === 0) return false;

      try {
        const u = new URL(rawUrl);
        let host = (u.hostname || "").toLowerCase();
        host = host.replace(/^www\./, "");
        if (host === domain) return true;
        return includeSubdomains && host.endsWith(`.${domain}`);
      } catch (_) {
        return false;
      }
    };

    const workspaces = await WSPStorageManger.getWorkspaces(windowId);
    const toWsp = workspaces.find(w => w && w.id === toWspId);
    if (!toWsp) {
      return { success: false, error: "Target workspace not found" };
    }

    const tabs = await browser.tabs.query({ windowId });
    const matchingTabs = tabs.filter(t => !t.pinned && matchesDomain(t.url));

    if (matchingTabs.length === 0) {
      return { success: true, movedCount: 0, domain };
    }

    const ownerByTabId = new Map();
    for (const wsp of workspaces) {
      const ids = Array.isArray(wsp?.tabs) ? wsp.tabs : [];
      for (const tabId of ids) {
        if (!ownerByTabId.has(tabId)) {
          ownerByTabId.set(tabId, wsp);
        }
      }
    }

    const toWspTabSet = new Set(Array.isArray(toWsp.tabs) ? toWsp.tabs : []);
    const tabIdsToAdd = [];
    const touched = new Set();
    let activeTabIdToFocus = null;

    for (const tab of matchingTabs) {
      const tabId = tab.id;
      if (!Number.isFinite(tabId)) continue;

      if (tab.active) {
        activeTabIdToFocus = tabId;
      }

      const fromWsp = ownerByTabId.get(tabId) || null;
      if (fromWsp && fromWsp.id === toWspId) {
        continue;
      }

      if (fromWsp) {
        const idx = fromWsp.tabs.indexOf(tabId);
        if (idx >= 0) {
          fromWsp.tabs.splice(idx, 1);
        }

        for (const group of Array.isArray(fromWsp.groups) ? fromWsp.groups : []) {
          const gIdx = Array.isArray(group.tabs) ? group.tabs.indexOf(tabId) : -1;
          if (gIdx >= 0) {
            group.tabs.splice(gIdx, 1);
          }
        }
        fromWsp.groups = (Array.isArray(fromWsp.groups) ? fromWsp.groups : []).filter(group => Array.isArray(group.tabs) && group.tabs.length > 0);
        touched.add(fromWsp);
      }

      if (!toWspTabSet.has(tabId)) {
        toWspTabSet.add(tabId);
        tabIdsToAdd.push(tabId);
      }
    }

    if (tabIdsToAdd.length === 0) {
      return { success: true, movedCount: 0, domain };
    }

    // Preserve the current tab-strip order while adding to the front of the workspace list.
    for (const tabId of tabIdsToAdd.slice().reverse()) {
      toWsp.tabs.unshift(tabId);
    }
    touched.add(toWsp);

    for (const wsp of touched) {
      await wsp._saveState();
    }
    await WSPStorageManger.flushPending().catch(() => {});

    // Avoid cross-workspace group drift by ungrouping moved tabs.
    await Brainer._safeTabsUngroup(tabIdsToAdd);

    if (activeTabIdToFocus !== null) {
      await Brainer.activateWsp(toWspId, windowId, activeTabIdToFocus);
    } else if (toWsp.active) {
      await Brainer._safeTabsShow(tabIdsToAdd);
    } else {
      await Brainer.hideInactiveWspTabs(windowId);
    }

    await this.refreshTabMenu();
    await this.updateBadge();

    return { success: true, movedCount: tabIdsToAdd.length, domain };
  }
}

(async () => {
  await Brainer.initialize();
})();
