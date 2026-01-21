if (browser) {
  const handlers = {
    getWorkspaces: async (message) => Brainer.getWorkspaces(message.windowId),
    createWorkspace: async (message) => {
      await Brainer.createWorkspace(message);
      return { success: true };
    },
    renameWorkspace: async (message) => {
      await Brainer.renameWorkspace(message.wspId, message.wspName);
      return { success: true };
    },
    updateWorkspace: async (message) => {
      const updates = {};
      if (message.wspName !== undefined) {
        updates.name = message.wspName;
      }
      if (message.color !== undefined) {
        updates.color = message.color;
      }
      if (message.tags !== undefined) {
        updates.tags = message.tags;
      }
      if (message.archived !== undefined) {
        updates.archived = message.archived;
      }
      if (message.lastActivatedAt !== undefined) {
        updates.lastActivatedAt = message.lastActivatedAt;
      }
      if (message.snoozedUntil !== undefined) {
        updates.snoozedUntil = message.snoozedUntil;
      }

      await Workspace.update(message.wspId, updates);
      await Brainer.updateBadge();
      return { success: true };
    },
    togglePinWorkspace: async (message) => {
      await Workspace.update(message.wspId, { pinned: message.pinned });
      return { success: true };
    },
    suspendWorkspace: async (message) => Brainer.suspendWorkspace(message.wspId),
    unsuspendWorkspace: async (message) => Brainer.unsuspendWorkspace(message.wspId),

    getRecentlyClosed: async (message) => WSPStorageManger.getRecentlyClosed(message.wspId),
    restoreRecentlyClosed: async (message) => Brainer.restoreRecentlyClosed(message.wspId, message.index),
    clearRecentlyClosed: async (message) => WSPStorageManger.clearRecentlyClosed(message.wspId),

    getTemplates: async () => WSPStorageManger.getTemplates(),
    saveTemplate: async (message) => WSPStorageManger.saveTemplate(message.template),
    deleteTemplate: async (message) => WSPStorageManger.deleteTemplate(message.templateId),
    renameTemplate: async (message) => WSPStorageManger.renameTemplate(message.templateId, message.newName),
    updateTemplate: async (message) => WSPStorageManger.updateTemplate(message.templateId, message.updates),
    createFromTemplate: async (message) => Brainer.createFromTemplate(message.templateId, message.windowId),

    moveTabToWorkspace: async (message) => {
      const tab = await browser.tabs.get(message.tabId);
      await Brainer.moveTabToWsp(tab, message.fromWspId, message.toWspId);
      return { success: true };
    },

    collectTabsByDomain: async (message) => Brainer.collectTabsByDomain(message),

    getWorkspaceOrder: async (message) => WSPStorageManger.getWorkspaceOrder(message.windowId),
    saveWorkspaceOrder: async (message) => {
      await WSPStorageManger.saveWorkspaceOrder(message.windowId, message.orderArray);
      return { success: true };
    },
    duplicateWorkspace: async (message) => Brainer.duplicateWorkspace(message.wspId, message.windowId),
    getNumWorkspaces: async (message) => Brainer.getNumWorkspaces(message.windowId),
    hideInactiveWspTabs: async (message) => {
      await Brainer.hideInactiveWspTabs(message.windowId);
      return { success: true };
    },
    suppressTabTracking: async (message) => {
      Brainer.suppressTabTracking(message.ms);
      return { success: true };
    },
    destroyWsp: async (message) => {
      await Brainer.destroyWsp(message.wspId);
      return { success: true };
    },
    activateWorkspace: async (message) => {
      await Brainer.activateWsp(message.wspId, message.windowId, message.tabId || null);
      return { success: true };
    },
    closeWorkspaceTabsWithUndo: async (message) => Brainer.closeWorkspaceTabsWithUndo(message.wspId),
    closeTabsWithUndo: async (message) => Brainer.closeTabsWithUndo(message),
    destroyWspWithUndo: async (message) => Brainer.destroyWspWithUndo(message),
    getUndoState: async () => Brainer.getUndoState(),
    undoLastAction: async () => Brainer.undoLastAction(),
    getWorkspaceName: async () => Brainer.generateWspName(),
    getPrimaryWindowId: async () => WSPStorageManger.getPrimaryWindowId(),
    getDiagnostics: async () => Brainer.getDiagnostics(),
    resetAllData: async (message) => Brainer.resetAllData(message.windowId),

    getSettings: async () => WSPStorageManger.getSettings(),
    saveSettings: async (message) => {
      await WSPStorageManger.saveSettings(message.settings);
      return { success: true };
    },
    runAutoArchiveNow: async () => Brainer.autoArchiveInactiveWorkspaces(),
    getTabLimit: async () => WSPStorageManger.getTabLimit(),
    setTabLimit: async (message) => {
      await WSPStorageManger.setTabLimit(message.limit);
      return { success: true };
    },

    getFolders: async (message) => WSPStorageManger.getFolders(message.windowId),
    createFolder: async (message) => WSPStorageManger.createFolder(message.windowId, message.folder),
    updateFolder: async (message) => WSPStorageManger.updateFolder(message.windowId, message.folderId, message.updates),
    deleteFolder: async (message) => WSPStorageManger.deleteFolder(message.windowId, message.folderId),
    addWorkspaceToFolder: async (message) => WSPStorageManger.addWorkspaceToFolder(message.windowId, message.wspId, message.folderId),
    removeWorkspaceFromFolder: async (message) => WSPStorageManger.removeWorkspaceFromFolder(message.windowId, message.wspId),

    getRules: async () => WSPStorageManger.getRules(),
    saveRules: async (message) => {
      await WSPStorageManger.saveRules(message.rules);
      return { success: true };
    },

    getSnoozes: async () => Brainer.getSnoozes(),
    snoozeWorkspace: async (message) => Brainer.snoozeWorkspace(message),
    snoozeTabs: async (message) => Brainer.snoozeTabs(message),
    cancelSnooze: async (message) => Brainer.cancelSnooze(message),
    wakeSnoozeNow: async (message) => Brainer.wakeSnoozeNow(message),
  };

  browser.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object" || typeof message.action !== "string") {
      // Ignore non-RPC messages (e.g., background → popup command signals).
      return;
    }

    const handler = handlers[message.action];
    if (!handler) {
      return { success: false, error: `Unknown action: ${message.action}` };
    }

    return (async () => {
      try {
        return await handler(message);
      } catch (e) {
        try {
          if (typeof Brainer !== "undefined" && typeof Brainer.recordError === "function") {
            Brainer.recordError(`handler:${message.action}`, e);
          }
        } catch (_) {}
        console.error(`handler.js error for action "${message.action}"`, e);
        return { success: false, error: e?.message ? String(e.message) : String(e) };
      }
    })();
  });
}
