class Workspace {
  constructor(id, state) {
    const s = state && typeof state === "object" ? state : {};

    this.id = id;
    this.name = typeof s.name === "string" && s.name.trim().length > 0 ? s.name : "Unnamed Workspace";
    this.color = typeof s.color === "string" ? s.color : "";
    this.pinned = !!s.pinned;
    this.suspended = !!s.suspended;
    this.active = !!s.active;
    this.archived = !!s.archived;
    this.lastActivatedAt = Number.isFinite(Number(s.lastActivatedAt)) ? Number(s.lastActivatedAt) : Date.now();
    const snoozedUntil = s.snoozedUntil == null ? null : Number(s.snoozedUntil);
    this.snoozedUntil = snoozedUntil != null && Number.isFinite(snoozedUntil) ? snoozedUntil : null;
    this.tags = Array.isArray(s.tags) ? s.tags : [];
    this.tabs = Array.isArray(s.tabs) ? s.tabs : [];
    this.windowId = Number.isFinite(Number(s.windowId)) ? Number(s.windowId) : null;
    this.groups = Array.isArray(s.groups) ? s.groups : [];
    this.lastActiveTabId = s.lastActiveTabId ?? null;
  }

  static async create(id, state) {
    const wspId = id || Date.now();

    const wsp = new Workspace(wspId, state);

    await wsp._saveState();
    await WSPStorageManger.addWsp(wspId, state.windowId);

    return wsp;
  }

  static async getWorkspaces(windowId) {
    return await WSPStorageManger.getWorkspaces(windowId);
  }

  async destroy() {
    const tabIds = Array.isArray(this.tabs) ? this.tabs : [];

    // Filter out invalid tab IDs (window-scoped)
    const openTabIds = new Set((await browser.tabs.query({ windowId: this.windowId })).map(tab => tab.id));
    this.tabs = tabIds.filter(tabId => openTabIds.has(tabId));

    if (this.tabs.length > 0) {
      await browser.tabs.remove(this.tabs);
    }
    await WSPStorageManger.deleteWspState(this.id);
    await WSPStorageManger.removeWsp(this.id, this.windowId);
  }

  async activate(activeTabId = null) {
    const tabIds = Array.isArray(this.tabs) ? this.tabs : [];

    // Filter out invalid tab IDs (window-scoped)
    const openTabIds = new Set((await browser.tabs.query({ windowId: this.windowId })).map(tab => tab.id));
    this.tabs = tabIds.filter(tabId => openTabIds.has(tabId));

    // reconstruct groups
    if (this.tabs.length > 0) {
      for (const group of this.groups) {
        group.tabs = (group.tabs || []).filter(tabId => openTabIds.has(tabId));
        if (group.tabs.length > 0) {
          const groupId = await browser.tabs.group({tabIds: group.tabs});
          await browser.tabGroups.update(groupId, {
            title: group.title,
            color: group.color,
            collapsed: group.collapsed
          });
        }
      }

      // show tabs
      await browser.tabs.show(this.tabs);
    }

    // set active tab
    const pinnedTabIds = (await browser.tabs.query({ windowId: this.windowId, pinned: true })).map(tab => tab.id);
    const tabIdToActivate = activeTabId || this.lastActiveTabId;
    const isValid = this.tabs.includes(tabIdToActivate) || pinnedTabIds.includes(tabIdToActivate);

    if (isValid || this.tabs.length > 0) {
      await browser.tabs.update(isValid ? tabIdToActivate : this.tabs[0], {active: true});
    } else {
      const windowId = this.windowId;
      const createTab = async () => {
        return await browser.tabs.create({
          active: true,
          windowId
        });
      };

      const newTab = (typeof Brainer !== "undefined" && typeof Brainer.withSuppressedTabTracking === "function")
        ? await Brainer.withSuppressedTabTracking(createTab)
        : await createTab();

      this.tabs = Array.isArray(this.tabs) ? this.tabs : [];
      this.tabs.push(newTab.id);
      this.lastActiveTabId = newTab.id;
    }

    this.active = true;
    this.archived = false;
    this.snoozedUntil = null;
    this.lastActivatedAt = Date.now();
    await this._saveState();
  }

  async hideTabs() {
    this.active = false;

    const tabIds = Array.isArray(this.tabs) ? this.tabs : [];

    // Filter out invalid tab IDs (window-scoped)
    const openTabIds = new Set((await browser.tabs.query({ windowId: this.windowId })).map(tab => tab.id));
    this.tabs = tabIds.filter(tabId => openTabIds.has(tabId));

    // hide
    if (this.tabs.length > 0) {
      await browser.tabs.hide(this.tabs);
      await browser.tabs.ungroup(this.tabs);
    }
    await this._saveState();
  }

  async updateTabGroups() {
    const groups = await browser.tabGroups.query({windowId: this.windowId});
    const tabs = await browser.tabs.query({windowId: this.windowId});

    this.groups = groups.map(group => {
      const tabIds = tabs
        .filter(tab => tab.groupId === group.id && this.tabs.includes(tab.id))
        .map(tab => tab.id);

      return {
        // groupId: group.id,
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
        tabs: tabIds
      };
    }).filter(group => group.tabs.length > 0);

    await this._saveState();
  }

  static async rename(wspId, wspName) {
    const state = await WSPStorageManger.getWspState(wspId);

    state.name = wspName;

    const wsp = new Workspace(wspId, state);

    await wsp._saveState();
  }

  static async update(wspId, updates) {
    const state = await WSPStorageManger.getWspState(wspId);

    if (updates.name !== undefined) {
      state.name = updates.name;
    }
    if (updates.color !== undefined) {
      state.color = updates.color;
    }
    if (updates.pinned !== undefined) {
      state.pinned = updates.pinned;
    }
    if (updates.suspended !== undefined) {
      state.suspended = updates.suspended;
    }
    if (updates.archived !== undefined) {
      state.archived = !!updates.archived;
    }
    if (updates.lastActivatedAt !== undefined) {
      const ts = Number(updates.lastActivatedAt);
      if (Number.isFinite(ts)) {
        state.lastActivatedAt = ts;
      }
    }
    if (updates.snoozedUntil !== undefined) {
      const ts = updates.snoozedUntil == null ? null : Number(updates.snoozedUntil);
      state.snoozedUntil = ts != null && Number.isFinite(ts) ? ts : null;
    }
    if (updates.tags !== undefined) {
      const rawTags = Array.isArray(updates.tags)
        ? updates.tags
        : (typeof updates.tags === "string" ? updates.tags.split(",") : []);

      state.tags = rawTags
        .map((t) => (typeof t === "string" ? t : String(t)).trim())
        .filter(t => t.length > 0);
    }

    const wsp = new Workspace(wspId, state);

    await wsp._saveState();
  }

  async _saveState() {
    await WSPStorageManger.saveWspState(this.id, {
      id: this.id,
      name: this.name,
      color: this.color,
      pinned: this.pinned,
      suspended: this.suspended,
      active: this.active,
      archived: this.archived,
      lastActivatedAt: this.lastActivatedAt,
      snoozedUntil: this.snoozedUntil,
      tags: this.tags,
      tabs: this.tabs,
      groups: this.groups,
      windowId: this.windowId,
      lastActiveTabId: this.lastActiveTabId
    });
  }
}
