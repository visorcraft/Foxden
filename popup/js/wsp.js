async function applyTheme() {
  try {
    const { colors = {}, properties = {} } = await browser.theme.getCurrent();

    // Mappings: theme.colors → CSS-Variablen
    const map = {
      toolbar:          '--bg-toolbar',
      frame_inactive:   '--bg-toolbar-inactive',
      toolbar_text:     '--text-toolbar',
      sidebar_text:     '--text-sidebar',
      popup:            '--bg-popup',
      popup_border:     '--border-popup',
      popup_highlight:  '--highlight-popup',
      popup_text:       '--text-popup',
      button:           '--button-bg',
      button_hover:     '--button-hover',
      button_active:    '--button-active',
      button_primary:   '--button-primary',
      button_primary_hover: '--button-primary-hover',
      button_primary_active: '--button-primary-active',
      button_primary_color: '--button-primary-text',
      input_background: '--input-bg',
      input_color:      '--input-text',
    };

    for (const [key, varName] of Object.entries(map)) {
      if (colors[key]) {
        document.documentElement.style.setProperty(varName, colors[key]);
      }
    }

    // Optional: System-Font aus properties übernehmen
    if (properties.color_scheme === 'dark') {
      document.documentElement.style.setProperty('--ui-font', 'menu');
    }
  }
  catch (e) {
    console.warn('Theme konnte nicht gelesen werden:', e);
  }
}

// Initial anwenden
(async () => {
  await applyTheme();
})();

// Auf Theme-Änderungen reagieren
browser.theme.onUpdated.addListener(applyTheme);


function showCustomDialog({ message, withInput = false, defaultValue = "", withColorPicker = false, defaultColor = "" }) {
  return new Promise((resolve) => {
    const backdrop = document.getElementById("custom-dialog-backdrop");
    const msgEl = document.getElementById("custom-dialog-message");
    const inputEl = document.getElementById("custom-dialog-input");
    const colorPicker = document.getElementById("custom-dialog-colors");
    const okBtn = document.getElementById("custom-dialog-ok");
    const cancelBtn = document.getElementById("custom-dialog-cancel");

    let selectedColor = defaultColor || "";

    msgEl.textContent = message;
    inputEl.hidden = !withInput;
    inputEl.value = defaultValue;
    colorPicker.hidden = !withColorPicker;

    // Reset color selection
    colorPicker.querySelectorAll(".color-option").forEach(opt => {
      opt.classList.remove("selected");
      if (opt.dataset.color === selectedColor) {
        opt.classList.add("selected");
      }
    });

    updateOkButtonState();

    backdrop.classList.add("show");
    if (withInput) {
      inputEl.focus();
      inputEl.select();
    }

    function cleanup(result) {
      backdrop.classList.remove("show");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      inputEl.removeEventListener("input", updateOkButtonState);
      inputEl.removeEventListener("keydown", onKeyDown);
      colorPicker.querySelectorAll(".color-option").forEach(opt => {
        opt.removeEventListener("click", onColorClick);
      });
      resolve(result);
    }

    function onOk() {
      if (withInput && withColorPicker) {
        cleanup({ name: inputEl.value, color: selectedColor });
      } else if (withInput) {
        cleanup(inputEl.value);
      } else {
        cleanup(true);
      }
    }

    function onCancel() {
      cleanup(false);
    }

    function updateOkButtonState() {
      okBtn.disabled = withInput && inputEl.value.trim().length === 0;
    }

    function onKeyDown(e) {
      if (e.key === "Enter" && !okBtn.disabled) {
        onOk();
      }
    }

    function onColorClick(e) {
      const color = e.target.dataset.color;
      selectedColor = color;
      colorPicker.querySelectorAll(".color-option").forEach(opt => opt.classList.remove("selected"));
      e.target.classList.add("selected");
    }

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    inputEl.addEventListener("input", updateOkButtonState);

    if (withInput) {
      inputEl.addEventListener("keydown", onKeyDown);
    }

    if (withColorPicker) {
      colorPicker.querySelectorAll(".color-option").forEach(opt => {
        opt.addEventListener("click", onColorClick);
      });
    }
  });
}

function installCustomDialogA11y() {
  const backdrop = document.getElementById("custom-dialog-backdrop");
  if (!backdrop) return;

  const dialog = backdrop.querySelector(".custom-dialog");
  if (!dialog) return;

  const cancelBtn = document.getElementById("custom-dialog-cancel");

  let previousFocusedEl = null;

  const isOpen = () => backdrop.classList.contains("show");

  const setAriaHidden = () => {
    backdrop.setAttribute("aria-hidden", isOpen() ? "false" : "true");
  };

  const getFocusable = () => {
    const nodes = Array.from(
      dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    );

    return nodes.filter(el => {
      if (!el || typeof el !== "object") return false;
      if (el.hasAttribute("disabled")) return false;
      if (el.getAttribute("aria-disabled") === "true") return false;
      if (el.hidden) return false;
      return el.offsetParent !== null;
    });
  };

  const focusInitial = () => {
    const input = dialog.querySelector("input:not([hidden]):not([disabled])");
    const fallback = dialog.querySelector('button:not([hidden]):not([disabled]), [href]:not([hidden])');
    (input || fallback || getFocusable()[0])?.focus?.();
  };

  const requestClose = () => {
    if (cancelBtn && !cancelBtn.hidden) {
      cancelBtn.click();
      return;
    }
    backdrop.classList.remove("show");
  };

  const onDocumentKeyDown = (e) => {
    if (!isOpen()) return;

    if (e.key === "Escape") {
      e.preventDefault();
      requestClose();
      return;
    }

    if (e.key !== "Tab") return;

    const focusable = getFocusable();
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (e.shiftKey) {
      if (active === first || !dialog.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const onBackdropClick = (e) => {
    if (!isOpen()) return;
    if (e.target === backdrop) {
      e.preventDefault();
      requestClose();
    }
  };

  const observer = new MutationObserver(() => {
    setAriaHidden();

    if (isOpen()) {
      previousFocusedEl = document.activeElement;
      // Defer to ensure dialog content has been fully updated/inserted.
      setTimeout(() => focusInitial(), 0);
    } else if (previousFocusedEl && previousFocusedEl.isConnected) {
      try {
        previousFocusedEl.focus?.();
      } catch (e) {
        // ignore
      } finally {
        previousFocusedEl = null;
      }
    }
  });

  observer.observe(backdrop, { attributes: true, attributeFilter: ["class"] });
  document.addEventListener("keydown", onDocumentKeyDown, true);
  backdrop.addEventListener("click", onBackdropClick);
  setAriaHidden();
}

installCustomDialogA11y();




class WorkspaceUI {
  constructor() {
    this.workspaces = [];
    this.allTabs = []; // Cache of all tabs with their workspace info
    this.customOrder = null; // Custom workspace order
    this.currentWindowId = null;
    this.tabLimit = 0; // 0 means no limit
    this.debug = false;
    this.folders = []; // Workspace folders
    this._undoToastInterval = null;
    this._undoToastTimeout = null;
    this._workspaceListKeyboardNavInstalled = false;
    this._searchCurrentResults = [];
    this._searchSelectedIndex = 0;
    this._searchVirtual = {
      enabled: false,
      query: "",
      rowHeight: 62,
      overscan: 8,
      raf: null
    };
  }

  _getBackgroundError(result) {
    if (result && typeof result === "object" && result.success === false && typeof result.error === "string") {
      return result.error;
    }
    return null;
  }

  _getOrCreateUndoToast() {
    let toast = document.getElementById("undo-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "undo-toast";
      toast.className = "undo-toast hidden";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");

      const message = document.createElement("div");
      message.className = "undo-toast-message";
      toast.appendChild(message);

      const actions = document.createElement("div");
      actions.className = "undo-toast-actions";

      const undoBtn = document.createElement("button");
      undoBtn.type = "button";
      undoBtn.id = "undo-toast-btn";
      undoBtn.textContent = "Undo";
      actions.appendChild(undoBtn);

      toast.appendChild(actions);
      document.body.appendChild(toast);
    }

    return {
      toast,
      messageEl: toast.querySelector(".undo-toast-message"),
      undoBtn: toast.querySelector("#undo-toast-btn")
    };
  }

  _hideUndoToast() {
    if (this._undoToastInterval) {
      clearInterval(this._undoToastInterval);
      this._undoToastInterval = null;
    }
    if (this._undoToastTimeout) {
      clearTimeout(this._undoToastTimeout);
      this._undoToastTimeout = null;
    }

    const toast = document.getElementById("undo-toast");
    if (toast) {
      toast.classList.add("hidden");
    }
  }

  _showUndoToast(undoState) {
    if (!undoState || undoState.available !== true) {
      this._hideUndoToast();
      return;
    }

    const expiresAt = Number(undoState.expiresAt);
    if (!Number.isFinite(expiresAt)) {
      this._hideUndoToast();
      return;
    }

    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) {
      this._hideUndoToast();
      return;
    }

    const { toast, messageEl, undoBtn } = this._getOrCreateUndoToast();
    if (messageEl) {
      messageEl.textContent = (undoState.message || "Action completed.").toString();
    }

    const updateLabel = () => {
      const remaining = Math.max(0, expiresAt - Date.now());
      const seconds = Math.ceil(remaining / 1000);
      if (undoBtn) {
        undoBtn.textContent = seconds > 0 ? `Undo (${seconds}s)` : "Undo";
      }
      if (remaining <= 0) {
        this._hideUndoToast();
      }
    };

    if (this._undoToastInterval) {
      clearInterval(this._undoToastInterval);
    }
    if (this._undoToastTimeout) {
      clearTimeout(this._undoToastTimeout);
    }

    updateLabel();
    this._undoToastInterval = setInterval(updateLabel, 1000);
    this._undoToastTimeout = setTimeout(() => this._hideUndoToast(), remainingMs + 50);

    if (undoBtn) {
      undoBtn.disabled = false;
      undoBtn.onclick = async () => {
        undoBtn.disabled = true;
        try {
          const result = await this._callBackgroundTask("undoLastAction");
          const err = this._getBackgroundError(result);
          if (err || result?.success !== true) {
            if (messageEl) {
              messageEl.textContent = `Undo failed: ${err || "Unknown error"}`;
            }
            setTimeout(() => this._hideUndoToast(), 2000);
            return;
          }

          window.location.reload();
        } catch (e) {
          if (messageEl) {
            messageEl.textContent = `Undo failed: ${e?.message ? String(e.message) : String(e)}`;
          }
          setTimeout(() => this._hideUndoToast(), 2000);
        }
      };
    }

    toast.classList.remove("hidden");
  }

  async _exportRawDataDump() {
    const diagnostics = await this._callBackgroundTask("getDiagnostics").catch(() => null);
    const storage = await browser.storage.local.get(null);

    const exportData = {
      type: "wsp-safe-mode-dump",
      exportDate: new Date().toISOString(),
      diagnostics,
      storage
    };

    const date = new Date().toISOString().split("T")[0];
    const filename = `workspaces-safe-mode-dump-${date}.json`;

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    await browser.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    });
  }

  async _enterSafeMode({ message, details = "" } = {}) {
    const container = document.getElementById("wsp-container");
    if (!container) return;

    const safeMessage = (message || "The extension data could not be loaded.").toString();
    const safeDetails = (details || "").toString();

    container.replaceChildren();

    const root = document.createElement("div");
    root.className = "safe-mode";

    const title = document.createElement("div");
    title.className = "safe-mode-title";
    title.textContent = "Safe mode";
    root.appendChild(title);

    const msg = document.createElement("div");
    msg.className = "safe-mode-message";
    msg.textContent = safeMessage;
    root.appendChild(msg);

    const actions = document.createElement("div");
    actions.className = "safe-mode-actions";

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.id = "safe-mode-export";
    exportBtn.textContent = "Export";
    actions.appendChild(exportBtn);

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.id = "safe-mode-reset";
    resetBtn.textContent = "Reset";
    actions.appendChild(resetBtn);

    root.appendChild(actions);

    if (safeDetails) {
      const pre = document.createElement("pre");
      pre.className = "safe-mode-details";
      pre.textContent = safeDetails;
      root.appendChild(pre);
    }

    container.appendChild(root);

    exportBtn?.addEventListener("click", async () => {
      try {
        await this._exportRawDataDump();
      } catch (e) {
        console.warn("Safe mode export failed:", e);
      }
    });

    resetBtn?.addEventListener("click", async () => {
      const confirmed = await showCustomDialog({
        message: "Reset all Foxden data? This cannot be undone.",
        withInput: false
      });
      if (!confirmed) return;

      const result = await this._callBackgroundTask("resetAllData", { windowId: this.currentWindowId }).catch((e) => ({
        success: false,
        error: e?.message ? String(e.message) : String(e)
      }));

      if (!result || result.success !== true) {
        await showCustomDialog({
          message: `Reset failed: ${result?.error || "Unknown error"}`,
          withInput: false
        });
        return;
      }

      window.close();
    });
  }

  async initialize() {
    try {
      this.currentWindowId = (await browser.windows.getCurrent()).id;

      const primaryWindowId = await this._callBackgroundTask("getPrimaryWindowId");
      const primaryWindowErr = this._getBackgroundError(primaryWindowId);
      if (primaryWindowErr) {
        await this._enterSafeMode({ message: "Failed to read primary window.", details: primaryWindowErr });
        return;
      }

      if (primaryWindowId !== this.currentWindowId) {
        // Check if the primary window actually exists - it may be stale after reinstall
        let primaryWindowExists = false;
        if (primaryWindowId != null) {
          try {
            await browser.windows.get(primaryWindowId);
            primaryWindowExists = true;
          } catch (e) {
            // Window doesn't exist - stale reference
            primaryWindowExists = false;
          }
        }

        // If primary window doesn't exist, auto-claim this window
        if (!primaryWindowExists) {
          try {
            const result = await this._callBackgroundTask("claimPrimaryWindow", {
              windowId: this.currentWindowId
            });
            if (result?.success) {
              location.reload();
              return;
            }
          } catch (e) {
            // Fall through to show manual button
          }
        }

        document.getElementById("createNewWsp").style.display = "none";
        document.querySelector(".search-container").style.display = "none";
        const wspList = document.getElementById("wsp-list");
        wspList.innerHTML = `
          <li class='no-wsp'>
            <span>Workspaces are managed in another window.</span>
            <button id="makePrimaryBtn" class="footer" style="margin-top: 16px; padding: 8px 16px; background-color: var(--button-primary); color: var(--button-primary-text); border: none; border-radius: 4px; cursor: pointer;">
              Use this window instead
            </button>
            <small style="margin-top: 8px; opacity: 0.7;">This will move your workspaces here.</small>
          </li>`;
        document.getElementById("makePrimaryBtn").addEventListener("click", async () => {
          const btn = document.getElementById("makePrimaryBtn");
          btn.disabled = true;
          btn.textContent = "Switching...";
          try {
            // Use claimPrimaryWindow if the other window is gone, rebindPrimaryWindow if it exists
            const result = primaryWindowExists
              ? await this._callBackgroundTask("rebindPrimaryWindow", {
                  oldWindowId: primaryWindowId,
                  newWindowId: this.currentWindowId
                })
              : await this._callBackgroundTask("claimPrimaryWindow", {
                  windowId: this.currentWindowId
                });
            if (result?.success) {
              location.reload();
            } else {
              btn.textContent = "Failed - try again";
              btn.disabled = false;
            }
          } catch (e) {
            btn.textContent = "Failed - try again";
            btn.disabled = false;
          }
        });
        return;
      }

    // Popup-only command helpers (triggered from background commands)
    browser.runtime.onMessage.addListener(async (message) => {
      if (message?.type === "wsp-focus-search") {
        await browser.storage.local.remove("wsp-focus-search-mode").catch(() => {});
        this._focusSearchInput();
      }

      if (message?.type === "wsp-create-workspace") {
        await browser.storage.local.remove("wsp-create-workspace-mode").catch(() => {});
        await this._promptCreateWorkspace();
      }
    });

    this.workspaces.push(...await this.getWorkspaces(this.currentWindowId));

    // If no workspaces exist, create a default one with current tabs
    if (this.workspaces.length === 0) {
      const currentTabs = await browser.tabs.query({ windowId: this.currentWindowId, pinned: false });
      const currentTabIds = currentTabs.map(t => t.id);

      const wspId = Date.now();
      await this._callBackgroundTask("createWorkspace", {
        id: wspId,
        name: "Unnamed Workspace",
        color: "",
        active: true,
        tabs: currentTabIds,
        windowId: this.currentWindowId
      });

      // Reload workspaces after creating
      this.workspaces.length = 0;
      this.workspaces.push(...await this.getWorkspaces(this.currentWindowId));
    }

    await this._loadAllTabs();

    // Load custom order
    this.customOrder = await this._callBackgroundTask("getWorkspaceOrder", { windowId: this.currentWindowId });

    // Load settings
    const settings = await this._callBackgroundTask("getSettings");
    const settingsErr = this._getBackgroundError(settings);
    if (settingsErr) {
      await this._enterSafeMode({ message: "Failed to load settings.", details: settingsErr });
      return;
    }
    this.tabLimit = settings.tabLimit || 0;
    this.debug = !!settings?.debug;

    const undoState = await this._callBackgroundTask("getUndoState").catch(() => null);
    if (undoState && undoState.available) {
      this._showUndoToast(undoState);
    }

    // Load folders
    this.folders = await this._callBackgroundTask("getFolders", { windowId: this.currentWindowId });
    const foldersErr = this._getBackgroundError(this.folders);
    if (foldersErr) {
      await this._enterSafeMode({ message: "Failed to load folders.", details: foldersErr });
      return;
    }
    if (!Array.isArray(this.folders)) {
      await this._enterSafeMode({ message: "Folders data is invalid.", details: JSON.stringify(this.folders) });
      return;
    }

    const initLabel = "wsp:popup:init";
    if (this.debug) console.time(initLabel);

    try {
    // Check if we're in move-tab mode (triggered by Alt+M)
    const moveMode = await browser.storage.local.get("wsp-move-tab-mode");
    if (moveMode["wsp-move-tab-mode"]) {
      await browser.storage.local.remove("wsp-move-tab-mode");
      await this._showMoveTabPicker(this.currentWindowId);
      return;
	    }
	
	    this.displayWorkspaces();
	    this._setupWorkspaceListKeyboardNavigation();
	    this.handleEvents();
	    this._setupSearch();
	    this._setupDragAndDrop();

    // Handle startup modes set by commands
    const createMode = await browser.storage.local.get("wsp-create-workspace-mode");
    if (createMode["wsp-create-workspace-mode"]) {
      await browser.storage.local.remove("wsp-create-workspace-mode");
      await this._promptCreateWorkspace();
    }

    const focusMode = await browser.storage.local.get("wsp-focus-search-mode");
    if (focusMode["wsp-focus-search-mode"]) {
      await browser.storage.local.remove("wsp-focus-search-mode");
      this._focusSearchInput();
    }
    } finally {
      if (this.debug) console.timeEnd(initLabel);
    }
    } catch (e) {
      await this._enterSafeMode({
        message: "Foxden could not be initialized.",
        details: e?.stack ? String(e.stack) : (e?.message ? String(e.message) : String(e))
      });
      return;
    }
  }

  async _loadAllTabs() {
    const windowId = this.currentWindowId || (await browser.windows.getCurrent()).id;
    const tabs = await browser.tabs.query({ windowId });

    const workspaceByTabId = new Map();
    for (const workspace of this.workspaces) {
      const wspTabIds = Array.isArray(workspace?.tabs) ? workspace.tabs : [];
      for (const tabId of wspTabIds) {
        if (!workspaceByTabId.has(tabId)) {
          workspaceByTabId.set(tabId, workspace);
        }
      }
    }

    this.allTabs = [];

    for (const tab of tabs) {
      const title = tab.title || "Untitled";
      const url = tab.url || "";
      const hostnameLower = this._getHostnameLowerFromUrl(url);

      const pinned = !!tab.pinned;
      const muted = !!tab.mutedInfo?.muted;
      const hidden = !!tab.hidden;
      const active = !!tab.active;

      const owner = pinned ? null : workspaceByTabId.get(tab.id);

      let wspId = null;
      let wspName = "";
      let wspNameLower = "";
      let wspColor = "";
      let wspTagsLower = "";

      if (owner) {
        wspId = owner.id;
        wspName = (owner?.name || "Unnamed Workspace").toString();
        wspNameLower = wspName.toLowerCase();
        wspColor = owner?.color || "";
        wspTagsLower = this._getWorkspaceTagsLower(owner);
      } else if (pinned) {
        wspName = "Pinned";
        wspNameLower = "pinned";
      } else {
        wspName = "Unassigned";
        wspNameLower = "unassigned";
      }

      this.allTabs.push({
        tabId: tab.id,
        title,
        titleLower: title.toLowerCase(),
        url,
        urlLower: url.toLowerCase(),
        hostnameLower,
        favIconUrl: tab.favIconUrl,
        pinned,
        muted,
        hidden,
        active,
        wspId,
        wspName,
        wspNameLower,
        wspColor,
        wspTagsLower,
        windowId: tab.windowId
      });
    }
  }

  _setupSearch() {
    const searchInput = document.getElementById("tab-search");
    const wspList = document.getElementById("wsp-list");
    const searchResults = document.getElementById("search-results");
    const footerContainer = document.querySelector(".footer-container");

    let selectedIndex = 0;
    let currentResults = [];

    const updateSelection = () => {
      this._searchSelectedIndex = selectedIndex;

      if (this._searchVirtual?.enabled) {
        this._ensureSearchResultIndexVisible(selectedIndex);
      }

      const items = Array.from(searchResults.querySelectorAll("[data-result-index]"));
      for (const item of items) {
        const idx = Number(item.dataset.resultIndex);
        const isSelected = idx === selectedIndex;
        item.classList.toggle("keyboard-selected", isSelected);
        item.setAttribute("aria-selected", isSelected ? "true" : "false");
      }

      const selected = items.find(item => Number(item.dataset.resultIndex) === selectedIndex);
      selected?.scrollIntoView?.({ block: "nearest" });
    };

    let debounceTimer = null;
    const debounceMs = 60;

    const runSearch = (rawQuery) => {
      const label = "wsp:search";
      if (this.debug) console.time(label);
      try {
        const trimmed = (rawQuery || "").toString().trim();

        // Command palette mode: `> something`
        if (trimmed.startsWith(">")) {
          const commandQueryRaw = trimmed.slice(1).trim();
          const commandQueryLower = commandQueryRaw.toLowerCase();
          const highlightQuery = commandQueryRaw.split(/\s+/).filter(Boolean)[0] || "";

          const matchingCommands = this._getCommandPaletteCommands()
            .map(cmd => ({
              cmd,
              score: this._getCommandSearchScore(cmd, commandQueryLower)
            }))
            .filter(x => x.score !== null)
            .sort((a, b) => a.score - b.score || a.cmd.name.localeCompare(b.cmd.name))
            .map(x => x.cmd);

          currentResults = matchingCommands.map(c => ({ type: "command", data: c }));
          this._displayCommandResults(matchingCommands, highlightQuery);
          updateSelection();
          return;
        }

        const parsed = this._parseSearchQuery(trimmed);
        const highlightQuery = parsed.freeTerms[0] || parsed.workspaceTerms[0] || parsed.tagTerms[0] || parsed.titleTerms[0] || parsed.urlTerms[0] || "";

        // Filter + rank workspaces (quick switcher)
        const matchingWorkspaces = this.workspaces
          .map(wsp => ({
            wsp,
            score: this._getWorkspaceSearchScore(wsp, parsed)
          }))
          .filter(x => x.score !== null)
          .sort((a, b) => a.score - b.score || a.wsp.name.localeCompare(b.wsp.name))
          .map(x => x.wsp);

        // Filter + rank tabs
        const matchingTabs = this.allTabs
          .map(tab => ({
            tab,
            score: this._getTabSearchScore(tab, parsed)
          }))
          .filter(x => x.score !== null)
          .sort((a, b) => a.score - b.score || (a.tab.title || "").localeCompare(b.tab.title || ""))
          .map(x => x.tab);

        currentResults = [
          ...matchingWorkspaces.map(w => ({ type: "workspace", data: w })),
          ...matchingTabs.map(t => ({ type: "tab", data: t }))
        ];

        this._displaySearchResults(matchingTabs, matchingWorkspaces, highlightQuery);
        updateSelection();
      } finally {
        if (this.debug) console.timeEnd(label);
      }
    };

    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.trim();
      selectedIndex = 0;

      clearTimeout(debounceTimer);

      if (query.length === 0) {
        // Show workspaces, hide search results
        wspList.hidden = false;
        searchResults.hidden = true;
        footerContainer.style.display = "";
        currentResults = [];
        this._searchCurrentResults = [];
        this._searchVirtual.enabled = false;
        return;
      }

      // Hide workspaces, show search results
      wspList.hidden = true;
      searchResults.hidden = false;
      footerContainer.style.display = "none";

      debounceTimer = setTimeout(() => runSearch(query), debounceMs);
    });

    // Keyboard navigation
    searchInput.addEventListener("keydown", async (e) => {
      const query = (searchInput.value || "").trim();
      if (query.length === 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        const focusables = Array.from(
          document.querySelectorAll('#wsp-list li.wsp-list-item[tabindex="0"], #wsp-list .folder-header[tabindex="0"], #wsp-list li.create-folder-link[tabindex="0"]')
        ).filter(el => el.offsetParent !== null);

        if (focusables.length > 0) {
          e.preventDefault();
          const next = e.key === "ArrowDown" ? focusables[0] : focusables[focusables.length - 1];
          next?.focus?.();
        }
        return;
      }

      const resultCount = currentResults.length;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, Math.max(0, resultCount - 1));
        updateSelection();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        updateSelection();
      } else if (e.key === "Enter" && resultCount > 0) {
        e.preventDefault();
        await this._activateSearchResult(currentResults[selectedIndex]);
      } else if (e.key === "Escape") {
        searchInput.value = "";
        searchInput.dispatchEvent(new Event("input"));
      }
    });

    searchResults.addEventListener("scroll", () => {
      if (this._searchVirtual?.enabled) {
        this._scheduleVirtualSearchRender();
      }
    });
  }

  _setupWorkspaceListKeyboardNavigation() {
    if (this._workspaceListKeyboardNavInstalled) return;
    this._workspaceListKeyboardNavInstalled = true;

    const list = document.getElementById("wsp-list");
    if (!list) return;

    const getFocusableItems = () => {
      const selector = [
        'li.wsp-list-item[tabindex="0"]',
        '.folder-header[tabindex="0"]',
        'li.create-folder-link[tabindex="0"]',
      ].join(", ");

      return Array.from(list.querySelectorAll(selector)).filter(el => el.offsetParent !== null);
    };

    const focusAt = (items, index) => {
      const next = items[index];
      next?.focus?.();
      next?.scrollIntoView?.({ block: "nearest" });
    };

    list.addEventListener("keydown", (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      const current = e.target.closest(
        'li.wsp-list-item[tabindex="0"], .folder-header[tabindex="0"], li.create-folder-link[tabindex="0"]'
      );
      if (!current) return;

      const items = getFocusableItems();
      if (items.length === 0) return;

      const index = items.indexOf(current);
      if (index === -1) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusAt(items, Math.min(index + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        focusAt(items, Math.max(index - 1, 0));
      } else if (e.key === "Home") {
        e.preventDefault();
        focusAt(items, 0);
      } else if (e.key === "End") {
        e.preventDefault();
        focusAt(items, items.length - 1);
      } else if (e.key === "Enter" || e.key === " ") {
        const innerInteractive = e.target.closest("a, button, input, select, textarea");
        if (innerInteractive && innerInteractive !== current) return;

        e.preventDefault();
        current.click();
      }
    });
  }

  async _activateSearchResult(result) {
    const entry = result && typeof result === "object" ? result : null;
    const type = (entry?.type || "").toString();
    const data = entry?.data;

    if (type === "command") {
      const cmd = data;
      try {
        if (typeof cmd?.run === "function") {
          await cmd.run();
        }
      } catch (e) {
        if (this.debug) console.warn("Command failed:", e);
        await showCustomDialog({
          message: `Command failed: ${e?.message ? String(e.message) : String(e)}`,
          withInput: false
        });
      }
      return;
    }

    if (type === "workspace") {
      const wsp = data;
      await this._callBackgroundTask("activateWorkspace", {
        wspId: wsp.id,
        windowId: wsp.windowId
      });
      window.close();
      return;
    }

    if (type === "tab") {
      const tab = data;

      // If the tab isn't owned by a workspace (Pinned/Unassigned), just show + focus it.
      if (tab?.wspId === null || tab?.wspId === undefined) {
        try {
          if (tab?.hidden) {
            await browser.tabs.show([tab.tabId]);
          }
          await browser.tabs.update(tab.tabId, { active: true });
        } catch (e) {
          if (this.debug) console.warn("Failed to focus tab from search:", e);
        } finally {
          window.close();
        }
        return;
      }

      // Otherwise, activate the workspace and switch to this tab
      await this._callBackgroundTask("activateWorkspace", {
        wspId: tab.wspId,
        windowId: tab.windowId,
        tabId: tab.tabId
      });
      window.close();
    }
  }

  _createSearchResultElement(result, query, index) {
    const entry = result && typeof result === "object" ? result : null;
    const type = (entry?.type || "").toString();
    const data = entry?.data;

    const li = document.createElement("li");
    li.dataset.resultIndex = String(index);
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");

    if (type === "command") {
      const cmd = data;
      li.className = "search-workspace-item search-command-item";

      const nameSpan = document.createElement("span");
      nameSpan.className = "search-workspace-name";
      this._applyHighlightedText(nameSpan, cmd?.name || "Command", query);
      li.appendChild(nameSpan);

      const desc = (cmd?.description || "").toString().trim();
      if (desc) {
        const descSpan = document.createElement("span");
        descSpan.className = "search-workspace-count";
        descSpan.textContent = desc;
        li.appendChild(descSpan);
      }

      const typeSpan = document.createElement("span");
      typeSpan.className = "search-result-type";
      typeSpan.textContent = "Command";
      li.appendChild(typeSpan);
    } else if (type === "workspace") {
      const wsp = data;
      li.className = "search-workspace-item";

      if (wsp?.color) {
        li.dataset.color = wsp.color;
        li.style.setProperty("--wsp-color", wsp.color);
      }

      const nameSpan = document.createElement("span");
      nameSpan.className = "search-workspace-name";
      this._applyHighlightedText(nameSpan, wsp?.name || "Workspace", query);
      li.appendChild(nameSpan);

      const countSpan = document.createElement("span");
      countSpan.className = "search-workspace-count";
      const tabCount = Array.isArray(wsp?.tabs) ? wsp.tabs.length : 0;
      countSpan.textContent = tabCount === 0 ? "(empty)" : `(${tabCount} tab${tabCount !== 1 ? "s" : ""})`;
      li.appendChild(countSpan);

      const typeSpan = document.createElement("span");
      typeSpan.className = "search-result-type";
      typeSpan.textContent = "Workspace";
      li.appendChild(typeSpan);
    } else if (type === "tab") {
      const tab = data;
      li.className = "search-result-item";

      if (tab?.wspColor) {
        li.dataset.color = tab.wspColor;
        li.style.setProperty("--wsp-color", tab.wspColor);
      }

      const titleSpan = document.createElement("span");
      titleSpan.className = "search-result-title";
      this._applyHighlightedText(titleSpan, tab?.title || "Untitled", query);
      li.appendChild(titleSpan);

      const wspSpan = document.createElement("span");
      wspSpan.className = "search-result-workspace";
      wspSpan.textContent = `in "${tab?.wspName || "Workspace"}"`;
      li.appendChild(wspSpan);

      li.addEventListener("mouseenter", (e) => {
        this._showTabPreview(tab, e);
      });
      li.addEventListener("mouseleave", () => {
        this._hideTabPreview();
      });
    } else {
      li.className = "search-no-results";
      li.setAttribute("aria-disabled", "true");
      li.textContent = "No results found";
      return li;
    }

    li.addEventListener("click", async () => {
      await this._activateSearchResult(entry);
    });

    return li;
  }

  _renderSearchNoResults(message) {
    const searchResults = document.getElementById("search-results");
    searchResults.replaceChildren();

    const noResults = document.createElement("li");
    noResults.className = "search-no-results";
    noResults.setAttribute("role", "option");
    noResults.setAttribute("aria-disabled", "true");
    noResults.textContent = (message || "No results found").toString();
    searchResults.appendChild(noResults);
  }

  _scheduleVirtualSearchRender() {
    const state = this._searchVirtual;
    if (!state?.enabled) return;
    if (state.raf) return;

    state.raf = requestAnimationFrame(() => {
      state.raf = null;
      this._renderVirtualSearchResults();
    });
  }

  _renderVirtualSearchResults() {
    const searchResults = document.getElementById("search-results");
    const results = Array.isArray(this._searchCurrentResults) ? this._searchCurrentResults : [];
    const query = (this._searchVirtual?.query || "").toString();

    if (results.length === 0) {
      this._renderSearchNoResults("No results found");
      return;
    }

    const rowHeight = Number(this._searchVirtual?.rowHeight) || 62;
    const overscan = Number(this._searchVirtual?.overscan) || 8;
    const scrollTop = searchResults.scrollTop;
    const viewportHeight = searchResults.clientHeight;

    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
    const endIndex = Math.min(results.length, startIndex + visibleCount);

    searchResults.replaceChildren();

    const topSpacer = document.createElement("li");
    topSpacer.setAttribute("aria-hidden", "true");
    topSpacer.style.height = `${startIndex * rowHeight}px`;
    topSpacer.style.margin = "0";
    topSpacer.style.padding = "0";
    topSpacer.style.pointerEvents = "none";
    searchResults.appendChild(topSpacer);

    for (let i = startIndex; i < endIndex; i++) {
      const li = this._createSearchResultElement(results[i], query, i);
      if (i === this._searchSelectedIndex) {
        li.classList.add("keyboard-selected");
        li.setAttribute("aria-selected", "true");
      }
      searchResults.appendChild(li);
    }

    const bottomSpacer = document.createElement("li");
    bottomSpacer.setAttribute("aria-hidden", "true");
    bottomSpacer.style.height = `${(results.length - endIndex) * rowHeight}px`;
    bottomSpacer.style.margin = "0";
    bottomSpacer.style.padding = "0";
    bottomSpacer.style.pointerEvents = "none";
    searchResults.appendChild(bottomSpacer);
  }

  _ensureSearchResultIndexVisible(index) {
    const state = this._searchVirtual;
    if (!state?.enabled) return;

    const searchResults = document.getElementById("search-results");
    const rowHeight = Number(state.rowHeight) || 62;

    const i = Number(index);
    if (!Number.isFinite(i) || i < 0) return;

    const viewTop = searchResults.scrollTop;
    const viewBottom = viewTop + searchResults.clientHeight;
    const itemTop = i * rowHeight;
    const itemBottom = itemTop + rowHeight;

    if (itemTop < viewTop) {
      searchResults.scrollTop = itemTop;
    } else if (itemBottom > viewBottom) {
      searchResults.scrollTop = Math.max(0, itemBottom - searchResults.clientHeight);
    }

    this._renderVirtualSearchResults();
  }

  _setSearchResults(results, query, { emptyMessage = "No results found" } = {}) {
    const searchResults = document.getElementById("search-results");
    const list = Array.isArray(results) ? results : [];

    this._searchCurrentResults = list;
    this._searchVirtual.query = (query || "").toString();

    // Reset scroll when new results arrive.
    searchResults.scrollTop = 0;

    const shouldVirtualize = list.length > 300;
    this._searchVirtual.enabled = shouldVirtualize;

    if (list.length === 0) {
      this._searchVirtual.enabled = false;
      this._renderSearchNoResults(emptyMessage);
      return;
    }

    if (shouldVirtualize) {
      this._renderVirtualSearchResults();
    } else {
      searchResults.replaceChildren();
      for (let i = 0; i < list.length; i++) {
        searchResults.appendChild(this._createSearchResultElement(list[i], this._searchVirtual.query, i));
      }
    }
  }

  _displaySearchResults(tabs, workspaces = [], query = "") {
    const results = [
      ...(Array.isArray(workspaces) ? workspaces : []).map(w => ({ type: "workspace", data: w })),
      ...(Array.isArray(tabs) ? tabs : []).map(t => ({ type: "tab", data: t })),
    ];

    this._setSearchResults(results, query, { emptyMessage: "No results found" });
  }

  _displayCommandResults(commands, query = "") {
    const results = (Array.isArray(commands) ? commands : []).map(c => ({ type: "command", data: c }));
    this._setSearchResults(results, query, { emptyMessage: "No commands found" });
  }

  async getWorkspaces(currentWindowId) {
    const result = await this._callBackgroundTask("getWorkspaces", { windowId: currentWindowId });
    const err = this._getBackgroundError(result);
    if (err) {
      throw new Error(err);
    }
    if (!Array.isArray(result)) {
      throw new Error("Invalid workspaces response");
    }
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  displayWorkspaces() {
    const wspList = document.getElementById("wsp-list");

    const visibleWorkspaces = this.workspaces.filter(w => !w.archived && w.snoozedUntil == null);
    const workspaceById = new Map(visibleWorkspaces.map(w => [String(w.id), w]));

    // Manual folder assignments take precedence.
    const assigned = new Set();
    const workspaceIdsByFolderId = new Map();
    for (const folder of this.folders) {
      const manualIds = Array.isArray(folder?.workspaceIds) ? folder.workspaceIds.map(String) : [];
      const unique = [];
      for (const id of manualIds) {
        if (!workspaceById.has(id)) continue;
        if (assigned.has(id)) continue;
        assigned.add(id);
        unique.push(id);
      }
      workspaceIdsByFolderId.set(folder.id, unique);
    }

    const domainsByWorkspaceId = this._getWorkspaceDomainsById();

    // Smart folder assignments apply to unassigned workspaces (first matching folder wins).
    for (const folder of this.folders) {
      const smart = folder?.smart && typeof folder.smart === "object" ? folder.smart : {};
      if (smart.enabled !== true) continue;

      const current = workspaceIdsByFolderId.get(folder.id) || [];
      for (const [id, workspace] of workspaceById.entries()) {
        if (assigned.has(id)) continue;
        if (!this._workspaceMatchesSmartFolderRules(workspace, smart, domainsByWorkspaceId.get(id))) continue;
        assigned.add(id);
        current.push(id);
      }
      workspaceIdsByFolderId.set(folder.id, current);
    }

    for (const folder of this.folders) {
      const ids = workspaceIdsByFolderId.get(folder.id) || [];
      const folderWorkspaces = ids.map(id => workspaceById.get(id)).filter(Boolean);
      const folderElement = this._createFolderElement(folder, folderWorkspaces);
      wspList.appendChild(folderElement);
    }

    // Get workspaces that are not in any folder (manual or smart)
    const rootWorkspaces = visibleWorkspaces.filter(w => !assigned.has(String(w.id)));

    // Display root workspaces
    rootWorkspaces.forEach(workspace => this._addWorkspace(workspace, false));

    this._sortWorkspaces();

    // Add "Create Folder" link at the end
    if (this.folders.length > 0 || this.workspaces.length > 3) {
      const createFolderLink = document.createElement("li");
      createFolderLink.className = "create-folder-link";
      createFolderLink.textContent = "+ New Folder";
      createFolderLink.tabIndex = 0;
      createFolderLink.setAttribute("role", "button");
      createFolderLink.addEventListener("click", async () => {
        await this._createFolder();
      });
      wspList.appendChild(createFolderLink);
    }
  }

  _getWorkspaceDomainsById() {
    const map = new Map();
    for (const tab of (Array.isArray(this.allTabs) ? this.allTabs : [])) {
      const wspId = tab?.wspId;
      if (wspId == null) continue;
      const host = (tab?.hostnameLower || "").toString();
      if (!host) continue;

      const key = String(wspId);
      let set = map.get(key);
      if (!set) {
        set = new Set();
        map.set(key, set);
      }
      set.add(host);
    }
    return map;
  }

  _hostMatchesDomain(hostLower, pattern) {
    const host = (hostLower || "").toString().trim().toLowerCase().replace(/^www\./, "");
    const p = (pattern || "").toString().trim().toLowerCase().replace(/^www\./, "");
    if (!host || !p) return false;

    if (!p.includes("*")) {
      return host === p || host.endsWith(`.${p}`);
    }

    const escaped = p.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`^${escaped.replace(/\\*/g, ".*")}$`, "i");
    return regex.test(host);
  }

  _workspaceMatchesSmartFolderRules(workspace, smart, domainsSet) {
    const rules = smart && typeof smart === "object" ? smart : {};

    const pinnedRule = typeof rules.pinned === "string" ? rules.pinned : "any";
    if (pinnedRule === "pinned" && !workspace?.pinned) return false;
    if (pinnedRule === "unpinned" && workspace?.pinned) return false;

    const tagRules = Array.isArray(rules.tags) ? rules.tags : [];
    const tags = tagRules
      .map(t => (t || "").toString().trim().toLowerCase())
      .filter(Boolean);

    const domainRules = Array.isArray(rules.domains) ? rules.domains : [];
    const domains = domainRules
      .map(d => (d || "").toString().trim().toLowerCase())
      .filter(Boolean);

    const hasAnyRule = pinnedRule !== "any" || tags.length > 0 || domains.length > 0;
    if (!hasAnyRule) return false;

    if (tags.length > 0) {
      const wspTags = Array.isArray(workspace?.tags) ? workspace.tags : [];
      const tagSet = new Set(wspTags.map(t => (t || "").toString().trim().toLowerCase()).filter(Boolean));
      if (!tags.some(t => tagSet.has(t))) {
        return false;
      }
    }

    if (domains.length > 0) {
      const set = domainsSet instanceof Set ? domainsSet : new Set();
      let matched = false;
      for (const domain of domains) {
        for (const host of set) {
          if (this._hostMatchesDomain(host, domain)) {
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
      if (!matched) {
        return false;
      }
    }

    return true;
  }

  handleEvents() {
    // Export workspaces
    document.getElementById("exportWorkspaces").addEventListener("click", async (e) => {
      e.preventDefault();
      await this._exportWorkspaces();
    });

    // Import workspaces
    document.getElementById("importWorkspaces").addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById("importFileInput").click();
    });

    document.getElementById("importFileInput").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (file) {
        await this._importWorkspaces(file);
        e.target.value = ""; // Reset input for future imports
      }
    });

    // Templates
    document.getElementById("templatesLink").addEventListener("click", async (e) => {
      e.preventDefault();
      await this._showTemplatesDialog();
    });

    // Settings
    document.getElementById("settingsLink").addEventListener("click", async (e) => {
      e.preventDefault();
      await this._showSettingsDialog();
    });

    document.getElementById("createNewWsp").addEventListener("click", async (e) => {
      e.preventDefault();
      await this._promptCreateWorkspace();
    });

  }

  _focusSearchInput() {
    const searchInput = document.getElementById("tab-search");
    if (!searchInput) return;
    searchInput.focus();
    searchInput.select();
  }

  async _promptCreateWorkspace() {
    const windowId = this.currentWindowId || (await browser.windows.getCurrent()).id;
    const wspId = Date.now();

    const result = await showCustomDialog({
      message: "Create workspace:",
      withInput: true,
      defaultValue: await this._callBackgroundTask("getWorkspaceName"),
      withColorPicker: true,
      defaultColor: "#2196f3" // Default to blue
    });
    if (result === false) {
      return; // User cancelled the dialog
    }

    const wspName = result.name.trim();
    if (wspName.length === 0) {
      return;
    }

    const wsp = {
      id: wspId,
      name: wspName,
      color: result.color,
      active: true,
      tabs: [],
      windowId: windowId
    };

    // Create a new workspace
    await this._callBackgroundTask("createWorkspace", wsp);

    // Create a temp tab for the new workspace (auto-added by background tab tracking)
    const tempTab = await browser.tabs.create({
      active: true,
      windowId
    });

    // Hide all other tabs from other workspaces
    await this._callBackgroundTask("hideInactiveWspTabs", { windowId });

    wsp.tabs.push(tempTab.id);
    this.workspaces.push(wsp);

    // Remove previously active list item
    this._removePreviouslyActiveLi();

    this._addWorkspace(wsp);
  }

  async _callBackgroundTask(action, args) {
    const message = { action, ...args };

    return browser ? await browser.runtime.sendMessage(message) : null;
  }

  _createListItemAndRegisterListeners(workspace) {
    const li = document.createElement("li");
    li.classList.add("wsp-list-item");
    li.draggable = true;
    li.tabIndex = 0;

    workspace.active && li.classList.add("active");

    li.dataset.wspId = workspace.id;

    // Apply workspace color as left border
    if (workspace.color) {
      li.dataset.color = workspace.color;
      li.style.setProperty("--wsp-color", workspace.color);
    }

    const dragHandle = document.createElement("span");
    dragHandle.className = "drag-handle";
    li.appendChild(dragHandle);

    const span1 = document.createElement("span");
    span1.spellcheck = false;
    span1.textContent = workspace.name;
    li.appendChild(span1);

    const span2 = document.createElement("span");
    span2.classList.add("tabs-qty");
    if (workspace.tabs.length === 0) {
      span2.textContent = "(empty)";
      li.classList.add("empty-workspace");
    } else {
      const tabCount = workspace.tabs.length;
      const exceedsLimit = this.tabLimit > 0 && tabCount > this.tabLimit;
      span2.textContent = "(" + tabCount + " tab" + (tabCount !== 1 ? "s" : "") + (exceedsLimit ? " \u26a0\ufe0f" : "") + ")";
      if (exceedsLimit) {
        span2.classList.add("tab-limit-warning");
        span2.title = `Exceeds tab limit of ${this.tabLimit}`;
        li.classList.add("exceeds-tab-limit");
      }
    }
    li.appendChild(span2);

    const deleteBtn = document.createElement("a");
    deleteBtn.href = "#";
    deleteBtn.classList.add("edit-btn", "delete-btn");
    deleteBtn.title = "Delete workspace";
    deleteBtn.setAttribute("aria-label", "Delete workspace");
    li.appendChild(deleteBtn);

    const copyUrlsBtn = document.createElement("a");
    copyUrlsBtn.href = "#";
    copyUrlsBtn.classList.add("edit-btn", "copy-urls-btn");
    copyUrlsBtn.title = "Copy all URLs";
    copyUrlsBtn.setAttribute("aria-label", "Copy all URLs");
    li.appendChild(copyUrlsBtn);

    const duplicateBtn = document.createElement("a");
    duplicateBtn.href = "#";
    duplicateBtn.classList.add("edit-btn", "duplicate-btn");
    duplicateBtn.title = "Duplicate workspace";
    duplicateBtn.setAttribute("aria-label", "Duplicate workspace");
    li.appendChild(duplicateBtn);

    const renameBtn = document.createElement("a");
    renameBtn.href = "#";
    renameBtn.classList.add("edit-btn", "rename-btn");
    renameBtn.title = "Rename workspace";
    renameBtn.setAttribute("aria-label", "Rename workspace");
    li.appendChild(renameBtn);

    const pinBtn = document.createElement("a");
    pinBtn.href = "#";
    pinBtn.classList.add("edit-btn", "pin-btn");
    pinBtn.title = workspace.pinned ? "Unpin workspace" : "Pin workspace";
    pinBtn.setAttribute("aria-label", workspace.pinned ? "Unpin workspace" : "Pin workspace");
    if (workspace.pinned) {
      pinBtn.classList.add("pinned");
      li.dataset.pinned = "true";
    }
    li.appendChild(pinBtn);

    const suspendBtn = document.createElement("a");
    suspendBtn.href = "#";
    suspendBtn.classList.add("edit-btn", "suspend-btn");
    suspendBtn.title = workspace.suspended ? "Wake workspace" : "Suspend workspace (free memory)";
    suspendBtn.setAttribute("aria-label", workspace.suspended ? "Wake workspace" : "Suspend workspace");
    if (workspace.suspended) {
      li.classList.add("suspended");
    }
    li.appendChild(suspendBtn);

    // More actions dropdown
    const moreContainer = document.createElement("div");
    moreContainer.className = "more-actions-container";

    const moreBtn = document.createElement("a");
    moreBtn.href = "#";
    moreBtn.classList.add("more-btn");
    moreBtn.title = "More actions";
    moreBtn.setAttribute("aria-label", "More actions");
    moreContainer.appendChild(moreBtn);

    const moreMenu = document.createElement("div");
    moreMenu.className = "more-actions-menu";
    moreMenu.innerHTML = `
      <a href="#" data-action="reload">Reload All Tabs</a>
      <a href="#" data-action="mute">Mute All Tabs</a>
      <a href="#" data-action="unmute">Unmute All Tabs</a>
      <a href="#" data-action="recentlyClosed">Recently Closed...</a>
      <a href="#" data-action="saveTemplate">Save as Template</a>
      <a href="#" data-action="tags">Tags...</a>
      <a href="#" data-action="moveToFolder">Move to Folder...</a>
      <a href="#" data-action="close" class="destructive">Close All Tabs</a>
    `;
    moreContainer.appendChild(moreMenu);
    li.appendChild(moreContainer);

    li.dataset.originalText = span1.textContent;

    // select a workspace
    li.addEventListener("click", async (e) => {
      if (li.classList.contains("active")) {
        // if the workspace is already active, do nothing
        return;
      }

      const lis = document.getElementsByTagName("li");

      // uncheck other boxes
      for (let i = 0; i < lis.length; i++) {
        lis[i].classList.remove("active");
      }

      li.classList.add("active");

      // activate this workspace
      await this._callBackgroundTask("activateWorkspace", { wspId: workspace.id, windowId: workspace.windowId });

      // close popup
      window.close();
    });

    // rename a workspace by clicking on the rename button
    renameBtn.addEventListener("click", async (e) => {
      e.stopPropagation();

      const currentColor = li.dataset.color || "";
      const result = await showCustomDialog({
        message: "Edit workspace:",
        withInput: true,
        defaultValue: li.dataset.originalText,
        withColorPicker: true,
        defaultColor: currentColor
      });

      if (result !== false) {
        const wspName = result.name.trim();
        if (wspName.length === 0) {
          return;
        }
        const wspId = li.dataset.wspId;
        li.dataset.originalText = wspName;
        span1.textContent = wspName;

        // Update color
        if (result.color) {
          li.dataset.color = result.color;
          li.style.setProperty("--wsp-color", result.color);
        } else {
          delete li.dataset.color;
          li.style.removeProperty("--wsp-color");
        }

        // Update workspace (name and color)
        await this._callBackgroundTask("updateWorkspace", { wspId, wspName, color: result.color });
      }
    });

    // delete a workspace
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();

      const deleteConfirmed = await showCustomDialog({ message: `Are you sure you want to delete "${li.dataset.originalText}"?` });
      if (!deleteConfirmed) {
        return;
      }

      const wasActive = li.classList.contains("active");
      const liParent = li.parentElement;

      // removing the active workspace
      li.parentNode.removeChild(li);
      if (li.classList.contains("active")) {
        // set the first child of the parent to be active
        const firstChild = liParent.children[0];

        if (firstChild) {
          firstChild.classList.add("active");
          firstChild.firstElementChild.checked = true;
          await this._callBackgroundTask("activateWorkspace", { wspId: firstChild.dataset.wspId, windowId: workspace.windowId });
        }
      }

      const result = await this._callBackgroundTask("destroyWspWithUndo", { wspId: workspace.id, wasActive });
      const err = this._getBackgroundError(result);
      if (err) {
        await showCustomDialog({ message: `Failed to delete workspace: ${err}` });
        window.location.reload();
        return;
      }

      this.workspaces = this.workspaces.filter(w => w.id !== workspace.id);
      await this._loadAllTabs();

      if (result?.undo?.available) {
        this._showUndoToast(result.undo);
      }
    });

    // duplicate a workspace
    duplicateBtn.addEventListener("click", async (e) => {
      e.stopPropagation();

      const result = await this._callBackgroundTask("duplicateWorkspace", {
        wspId: workspace.id,
        windowId: workspace.windowId
      });

      if (result && result.workspace) {
        // Add the new workspace to our local array and display it
        this.workspaces.push(result.workspace);
        this._addWorkspace(result.workspace);
        // Reload tabs for search
        await this._loadAllTabs();
      }
    });

    // copy all URLs from workspace
    copyUrlsBtn.addEventListener("click", async (e) => {
      e.stopPropagation();

      // Get all tab URLs from this workspace
      const urls = [];
      for (const tabId of workspace.tabs) {
        try {
          const tab = await browser.tabs.get(tabId);
          urls.push(tab.url);
        } catch (e) {
          // Tab may no longer exist
        }
      }

      if (urls.length === 0) {
        await showCustomDialog({ message: "No URLs to copy - workspace is empty." });
        return;
      }

      // Copy to clipboard
      try {
        await navigator.clipboard.writeText(urls.join('\n'));
        // Show brief feedback by changing the button temporarily
        copyUrlsBtn.classList.add("copied");
        setTimeout(() => copyUrlsBtn.classList.remove("copied"), 1500);
      } catch (e) {
        await showCustomDialog({ message: "Failed to copy URLs to clipboard." });
      }
    });

    // pin/unpin workspace
    pinBtn.addEventListener("click", async (e) => {
      e.stopPropagation();

      const isPinned = pinBtn.classList.contains("pinned");
      const newPinned = !isPinned;

      // Update UI
      if (newPinned) {
        pinBtn.classList.add("pinned");
        pinBtn.title = "Unpin workspace";
        pinBtn.setAttribute("aria-label", "Unpin workspace");
        li.dataset.pinned = "true";
      } else {
        pinBtn.classList.remove("pinned");
        pinBtn.title = "Pin workspace";
        pinBtn.setAttribute("aria-label", "Pin workspace");
        delete li.dataset.pinned;
      }

      // Update workspace in local array
      workspace.pinned = newPinned;

      // Save to storage
      await this._callBackgroundTask("togglePinWorkspace", { wspId: workspace.id, pinned: newPinned });

      // Re-sort workspaces
      this._sortWorkspaces();
    });

    // suspend/unsuspend workspace
    suspendBtn.addEventListener("click", async (e) => {
      e.stopPropagation();

      // Don't allow suspending active workspace
      if (workspace.active) {
        await showCustomDialog({ message: "Cannot suspend the active workspace." });
        return;
      }

      const isSuspended = li.classList.contains("suspended");

      if (isSuspended) {
        // Unsuspend
        await this._callBackgroundTask("unsuspendWorkspace", { wspId: workspace.id });
        li.classList.remove("suspended");
        suspendBtn.title = "Suspend workspace (free memory)";
        suspendBtn.setAttribute("aria-label", "Suspend workspace");
        workspace.suspended = false;
      } else {
        // Suspend
        const result = await this._callBackgroundTask("suspendWorkspace", { wspId: workspace.id });
        if (result && result.success) {
          li.classList.add("suspended");
          suspendBtn.title = "Wake workspace";
          suspendBtn.setAttribute("aria-label", "Wake workspace");
          workspace.suspended = true;
        }
      }
    });

    // More actions menu toggle
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      // Close any other open menus
      document.querySelectorAll(".more-actions-menu.show").forEach(menu => {
        if (menu !== moreMenu) menu.classList.remove("show");
      });
      moreMenu.classList.toggle("show");
    });

    // Close menu when clicking outside
    document.addEventListener("click", () => {
      moreMenu.classList.remove("show");
    });

    // More actions menu handlers
    moreMenu.addEventListener("click", async (e) => {
      e.stopPropagation();
      const action = e.target.dataset.action;
      if (!action) return;

      moreMenu.classList.remove("show");

      if (action === "reload") {
        // Reload all tabs
        let reloadedCount = 0;
        for (const tabId of workspace.tabs) {
          try {
            await browser.tabs.reload(tabId);
            reloadedCount++;
          } catch (err) { /* Tab may not exist */ }
        }
        await showCustomDialog({ message: `Reloaded ${reloadedCount} tab(s).` });

      } else if (action === "mute") {
        // Mute all tabs
        for (const tabId of workspace.tabs) {
          try {
            await browser.tabs.update(tabId, { muted: true });
          } catch (err) { /* Tab may not exist */ }
        }
        await showCustomDialog({ message: `Muted all tabs in "${workspace.name}".` });

      } else if (action === "unmute") {
        // Unmute all tabs
        for (const tabId of workspace.tabs) {
          try {
            await browser.tabs.update(tabId, { muted: false });
          } catch (err) { /* Tab may not exist */ }
        }
        await showCustomDialog({ message: `Unmuted all tabs in "${workspace.name}".` });

      } else if (action === "recentlyClosed") {
        // Show recently closed tabs
        const closedTabs = await this._callBackgroundTask("getRecentlyClosed", { wspId: workspace.id });

        if (!closedTabs || closedTabs.length === 0) {
          await showCustomDialog({ message: "No recently closed tabs." });
          return;
        }

        // Show dialog with list of recently closed tabs
        await this._showRecentlyClosedDialog(workspace, closedTabs);

      } else if (action === "saveTemplate") {
        // Save workspace as template
        if (workspace.tabs.length === 0) {
          await showCustomDialog({ message: "Cannot save empty workspace as template." });
          return;
        }

        const templateName = await showCustomDialog({
          message: "Save as template:",
          withInput: true,
          defaultValue: `${workspace.name} Template`
        });

        if (templateName && templateName.trim()) {
          // Get tab URLs
          const tabs = [];
          const tabIdToIndex = new Map();
          for (const tabId of workspace.tabs) {
            try {
              const tab = await browser.tabs.get(tabId);
              if (tab.url && !tab.url.startsWith("about:") && !tab.url.startsWith("chrome:") && !tab.url.startsWith("moz-extension:")) {
                tabIdToIndex.set(tabId, tabs.length);
                tabs.push({ url: tab.url, title: tab.title || tab.url });
              }
            } catch (err) { /* Tab may not exist */ }
          }

          if (tabs.length === 0) {
            await showCustomDialog({ message: "No valid tabs to save in template." });
            return;
          }

          const groups = (workspace.groups || [])
            .map(group => {
              const tabIndices = (group.tabs || [])
                .map(tabId => tabIdToIndex.get(tabId))
                .filter(idx => idx !== undefined);

              return {
                title: group.title || group.name || "",
                color: group.color,
                collapsed: !!group.collapsed,
                tabIndices
              };
            })
            .filter(group => group.tabIndices.length > 0);

          await this._callBackgroundTask("saveTemplate", {
            template: {
              name: templateName.trim(),
              color: workspace.color,
              tabs: tabs,
              groups
            }
          });

          await showCustomDialog({ message: `Template "${templateName.trim()}" saved with ${tabs.length} tab(s).` });
        }

      } else if (action === "tags") {
        await this._showTagsDialog(workspace);

      } else if (action === "moveToFolder") {
        // Move workspace to folder
        await this._showMoveToFolderDialog(workspace);

      } else if (action === "close") {
        // Close all tabs (with confirmation)
        if (workspace.tabs.length === 0) {
          await showCustomDialog({ message: "Workspace is already empty." });
          return;
        }

        const confirmed = await showCustomDialog({
          message: `Close all ${workspace.tabs.length} tab(s) in "${workspace.name}"? The workspace will remain.`
        });

        if (confirmed) {
          const result = await this._callBackgroundTask("closeWorkspaceTabsWithUndo", { wspId: workspace.id });
          const err = this._getBackgroundError(result);
          if (err) {
            await showCustomDialog({ message: `Failed to close tabs: ${err}` });
            return;
          }

          workspace.tabs = [];
          workspace.groups = [];
          span2.textContent = "(empty)";
          li.classList.add("empty-workspace");
          await this._loadAllTabs();

          if (result?.undo?.available) {
            this._showUndoToast(result.undo);
          }
        }
      }
    });

    return li;
  }

  _addWorkspace(workspace, doSort = true) {
    const wspList = document.getElementById("wsp-list");

    const li = this._createListItemAndRegisterListeners(workspace);

    wspList.appendChild(li);

    if (doSort) {
      // it could have been sorted in place while added to the list
      // however, this is easier to understand and implement
      // if performance is an issue, then switch back to sort on fly
      this._sortWorkspaces();
    }

    return li;
  }

  _sortWorkspaces() {
    const list = document.getElementById("wsp-list");
    const createFolderLinks = Array.from(list.querySelectorAll(".create-folder-link"));
    createFolderLinks.forEach(link => link.remove());

    const items = Array.from(list.children).filter(el => el.matches("li.wsp-list-item, li.folder-item"));

    // Remove existing separators
    list.querySelectorAll(".pinned-separator").forEach(sep => sep.remove());

    // Sort: pinned first, then folders, then by custom order or alphabetically
    items.sort((a, b) => {
      const aPinned = a.dataset.pinned === "true";
      const bPinned = b.dataset.pinned === "true";

      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;

      if (this.customOrder) {
        const aIsFolder = a.classList.contains("folder-item");
        const bIsFolder = b.classList.contains("folder-item");

        const aId = aIsFolder ? a.dataset.folderId : a.dataset.wspId;
        const bId = bIsFolder ? b.dataset.folderId : b.dataset.wspId;

        const aIndex = this.customOrder.indexOf(aId);
        const bIndex = this.customOrder.indexOf(bId);

        const aOrder = aIndex !== -1
          ? aIndex
          : (aIsFolder ? -1000 : 9999);
        const bOrder = bIndex !== -1
          ? bIndex
          : (bIsFolder ? -1000 : 9999);

        if (aOrder !== bOrder) return aOrder - bOrder;
      }

      return a.dataset.originalText.localeCompare(b.dataset.originalText);
    });

    // Re-append items in sorted order
    items.forEach(item => list.appendChild(item));

    // Add separator between pinned and unpinned sections if both exist
    const pinnedItems = items.filter(item => item.dataset.pinned === "true");
    const unpinnedItems = items.filter(item => item.dataset.pinned !== "true");

    if (pinnedItems.length > 0 && unpinnedItems.length > 0) {
      const separator = document.createElement("li");
      separator.className = "pinned-separator";
      separator.textContent = "Other Workspaces";
      list.insertBefore(separator, unpinnedItems[0]);
    }

    createFolderLinks.forEach(link => list.appendChild(link));
  }

  _setupDragAndDrop() {
    const list = document.getElementById("wsp-list");
    let draggedItem = null;

    list.addEventListener("dragstart", (e) => {
      const item = e.target.closest("li.wsp-list-item");
      if (item) {
        draggedItem = item;
        item.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", item.dataset.wspId);
        // Store the source folder if dragging from a folder
        if (item.dataset.folderId) {
          e.dataTransfer.setData("source-folder", item.dataset.folderId);
        }
      }
    });

    list.addEventListener("dragend", (e) => {
      const item = e.target.closest("li.wsp-list-item");
      if (item) {
        item.classList.remove("dragging");
        // Remove all drag-over classes
        list.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
        list.classList.remove("drag-over-root");
        draggedItem = null;
      }
    });

    list.addEventListener("dragover", (e) => {
      e.preventDefault();
      const target = e.target.closest("li.wsp-list-item");

      // Check if dragging over root level (the list itself, not a folder content)
      const isOverFolder = e.target.closest(".folder-contents");
      const isOverFolderHeader = e.target.closest(".folder-header");

      if (target && target !== draggedItem) {
        // Remove drag-over from others
        list.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
        list.classList.remove("drag-over-root");
        target.classList.add("drag-over");
      } else if (!isOverFolder && !isOverFolderHeader && draggedItem && draggedItem.dataset.folderId) {
        // Dragging from folder over root area - show root drop indicator
        list.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
        list.classList.add("drag-over-root");
      }
    });

    list.addEventListener("dragleave", (e) => {
      const target = e.target.closest("li.wsp-list-item");
      if (target) {
        target.classList.remove("drag-over");
      }
      // Only remove root indicator if leaving the list entirely
      if (e.target === list && !list.contains(e.relatedTarget)) {
        list.classList.remove("drag-over-root");
      }
    });

    list.addEventListener("drop", async (e) => {
      e.preventDefault();
      const target = e.target.closest("li.wsp-list-item");
      const wspId = e.dataTransfer.getData("text/plain");
      const sourceFolderId = draggedItem?.dataset.folderId;

      // Check if dropping on root level (not inside a folder)
      const isInFolder = e.target.closest(".folder-contents");
      const isOnFolderHeader = e.target.closest(".folder-header");

      // Ignore drops inside folder contents (folders handle drops via header)
      if (isInFolder) {
        list.classList.remove("drag-over-root");
        return;
      }

      // If dragging from a folder and dropping outside folders, remove from folder
      if (sourceFolderId && !isInFolder && !isOnFolderHeader && draggedItem) {
        await this._callBackgroundTask("removeWorkspaceFromFolder", {
          windowId: this.currentWindowId,
          wspId: wspId
        });
        // Refresh the list to show the workspace at root level
        this.folders = await this._callBackgroundTask("getFolders", { windowId: this.currentWindowId });
        document.getElementById("wsp-list").innerHTML = "";
        this.displayWorkspaces();
        list.classList.remove("drag-over-root");
        return;
      }

      // Only support reordering at root level (not within folders)
      if (target && draggedItem && target !== draggedItem && !sourceFolderId && !target.dataset.folderId) {
        // Determine drop position
        const items = Array.from(list.children).filter(el => el.matches("li.wsp-list-item"));
        const draggedIndex = items.indexOf(draggedItem);
        const targetIndex = items.indexOf(target);

        if (draggedIndex === -1 || targetIndex === -1) {
          list.classList.remove("drag-over-root");
          return;
        }

        // Insert before target
        if (draggedIndex < targetIndex) {
          target.parentNode.insertBefore(draggedItem, target.nextSibling);
        } else {
          target.parentNode.insertBefore(draggedItem, target);
        }

        target.classList.remove("drag-over");

        // Save new order
        await this._saveCurrentOrder();
      }

      list.classList.remove("drag-over-root");
    });
  }

  async _saveCurrentOrder() {
    const list = document.getElementById("wsp-list");
    const items = Array.from(list.children).filter(el => el.matches("li.wsp-list-item"));
    const orderArray = items.map(item => item.dataset.wspId);

    this.customOrder = orderArray;
    await this._callBackgroundTask("saveWorkspaceOrder", {
      windowId: this.currentWindowId,
      orderArray: orderArray
    });
  }

  _removePreviouslyActiveLi() {
    const lis = document.getElementsByClassName("active");

    for (const li of lis) {
      li.classList.remove("active");
      li.firstElementChild.checked = false;
    }
  }

  async _exportWorkspaces() {
    try {
      const exportData = {
        version: 1,
        exportDate: new Date().toISOString(),
        workspaces: []
      };

      for (const workspace of this.workspaces) {
        const workspaceTabIds = Array.isArray(workspace.tabs) ? workspace.tabs : [];
        const workspaceGroups = Array.isArray(workspace.groups) ? workspace.groups : [];

        const wspExport = {
          name: workspace.name,
          color: workspace.color || "",
          pinned: workspace.pinned || false,
          tags: Array.isArray(workspace.tags) ? workspace.tags : [],
          tabs: [],
          groups: workspaceGroups
            .map(group => {
              const tabIndices = (group.tabs || [])
                .map(tabId => workspaceTabIds.indexOf(tabId))
                .filter(idx => idx >= 0);

              return {
                title: group.title || group.name || "",
                color: group.color,
                collapsed: !!group.collapsed,
                tabIndices
              };
            })
            .filter(group => group.tabIndices.length > 0)
        };

        // Get tab URLs and titles
        for (const tabId of workspaceTabIds) {
          try {
            const tab = await browser.tabs.get(tabId);
            wspExport.tabs.push({
              url: tab.url,
              title: tab.title || ""
            });
          } catch (e) {
            // Tab may no longer exist, skip it
          }
        }

        exportData.workspaces.push(wspExport);
      }

      // Generate filename with date
      const date = new Date().toISOString().split("T")[0];
      const filename = `workspaces-export-${date}.json`;

      // Create blob and download
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      await browser.downloads.download({
        url: url,
        filename: filename,
        saveAs: true
      });

      URL.revokeObjectURL(url);

      await showCustomDialog({ message: `Exported ${exportData.workspaces.length} workspace(s) successfully.` });
    } catch (e) {
      console.error("Export error:", e);
      await showCustomDialog({ message: "Failed to export workspaces. Please try again." });
    }
  }

  async _showMoveTabPicker(windowId) {
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) {
      window.close();
      return;
    }

    const highlightedTabs = await browser.tabs.query({ currentWindow: true, highlighted: true });
    const tabsToMove = highlightedTabs.length > 1 && highlightedTabs.some(t => t.id === activeTab.id)
      ? highlightedTabs
      : [activeTab];

    const activeWsp = this.workspaces.find(w => w.active);
    if (!activeWsp) {
      window.close();
      return;
    }

    const fromWspByTabId = new Map();
    for (const tab of tabsToMove) {
      const owner = this.workspaces.find(w => Array.isArray(w.tabs) && w.tabs.includes(tab.id));
      if (owner) {
        fromWspByTabId.set(tab.id, owner.id);
      }
    }

    const otherWorkspaces = this.workspaces.filter(w => !w.active && !w.archived && w.snoozedUntil == null);

    if (otherWorkspaces.length === 0) {
      document.getElementById("wsp-list").innerHTML = "<li class='no-wsp'>No other workspaces to move to.<br><small>Create another workspace first.</small></li>";
      document.getElementById("createNewWsp").style.display = "none";
      document.querySelector(".search-container").style.display = "none";
      document.querySelector(".footer-container").style.display = "none";
      return;
    }

    // Hide normal UI elements
    document.getElementById("createNewWsp").style.display = "none";
    document.querySelector(".footer-container").style.display = "none";
    document.getElementById("search-results").hidden = true;
    document.getElementById("wsp-list").hidden = false;

    // Setup filter input (reuse the search bar)
    const searchContainer = document.querySelector(".search-container");
    searchContainer.style.display = "";
    const searchInput = document.getElementById("tab-search");
    searchInput.value = "";
    searchInput.placeholder = "Filter workspaces...";
    searchInput.focus();

    const wspList = document.getElementById("wsp-list");
    let selectedIndex = 0;

    const updateSelection = () => {
      const items = wspList.querySelectorAll("li.wsp-list-item.move-target-item");
      items.forEach((item, i) => item.classList.toggle("keyboard-selected", i === selectedIndex));
      items[selectedIndex]?.scrollIntoView({ block: "nearest" });
    };

    const render = (filterQuery) => {
      const q = (filterQuery || "").trim().toLowerCase();
      selectedIndex = 0;

      const targets = otherWorkspaces
        .map(wsp => ({
          wsp,
          score: q.length === 0 ? 0 : this._getMatchScoreLower(this._getWorkspaceNameLower(wsp), q)
        }))
        .filter(x => q.length === 0 || x.score !== null)
        .sort((a, b) => {
          if (a.wsp.pinned && !b.wsp.pinned) return -1;
          if (!a.wsp.pinned && b.wsp.pinned) return 1;
          return (a.score - b.score) || a.wsp.name.localeCompare(b.wsp.name);
        })
        .map(x => x.wsp);

      wspList.innerHTML = "";

      const header = document.createElement("li");
      header.className = "move-tab-header";
      header.style.cssText = "padding: 10px; text-align: center; font-weight: 500;";
      header.textContent = `Move ${tabsToMove.length} tab${tabsToMove.length !== 1 ? "s" : ""} to workspace:`;
      wspList.appendChild(header);

      if (targets.length === 0) {
        const noResults = document.createElement("li");
        noResults.className = "search-no-results";
        noResults.textContent = "No matching workspaces";
        wspList.appendChild(noResults);
      } else {
        for (const wsp of targets) {
          const li = document.createElement("li");
          li.classList.add("wsp-list-item", "move-target-item");
          li.style.cursor = "pointer";

          if (wsp.color) {
            li.dataset.color = wsp.color;
            li.style.setProperty("--wsp-color", wsp.color);
          }

          const nameSpan = document.createElement("span");
          this._applyHighlightedText(nameSpan, wsp.name, q);
          li.appendChild(nameSpan);

          const countSpan = document.createElement("span");
          countSpan.classList.add("tabs-qty");
          countSpan.textContent = `(${wsp.tabs.length} tab${wsp.tabs.length !== 1 ? "s" : ""})`;
          li.appendChild(countSpan);

          li.addEventListener("click", async () => {
            for (const tab of tabsToMove) {
              const fromWspId = fromWspByTabId.get(tab.id);
              if (!fromWspId) continue;
              await this._callBackgroundTask("moveTabToWorkspace", {
                tabId: tab.id,
                fromWspId,
                toWspId: wsp.id
              });
            }
            window.close();
          });

          wspList.appendChild(li);
        }
      }

      const cancelLi = document.createElement("li");
      cancelLi.style.cssText = "padding: 10px; text-align: center; cursor: pointer; opacity: 0.7;";
      cancelLi.textContent = "Cancel (Esc)";
      cancelLi.addEventListener("click", () => window.close());
      wspList.appendChild(cancelLi);

      updateSelection();
    };

    render("");

    searchInput.addEventListener("input", (e) => render(e.target.value));
    searchInput.addEventListener("keydown", (e) => {
      const items = wspList.querySelectorAll("li.wsp-list-item.move-target-item");

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (items.length === 0) return;
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        updateSelection();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (items.length === 0) return;
        selectedIndex = Math.max(selectedIndex - 1, 0);
        updateSelection();
      } else if (e.key === "Enter" && items.length > 0) {
        e.preventDefault();
        items[selectedIndex]?.click();
      } else if (e.key === "Escape") {
        e.preventDefault();
        window.close();
      }
    });
  }

  async _showTemplatesDialog() {
    const templates = await this._callBackgroundTask("getTemplates");

    const backdrop = document.getElementById("custom-dialog-backdrop");
    const msgEl = document.getElementById("custom-dialog-message");
    const inputEl = document.getElementById("custom-dialog-input");
    const colorPicker = document.getElementById("custom-dialog-colors");
    const okBtn = document.getElementById("custom-dialog-ok");
    const cancelBtn = document.getElementById("custom-dialog-cancel");

    msgEl.innerHTML = `<strong>Workspace Templates</strong><br><small>Click to create workspace</small>`;
    inputEl.hidden = true;
    colorPicker.hidden = true;

    // Create list container
    const listContainer = document.createElement("div");
    listContainer.className = "templates-list";
    listContainer.style.cssText = "max-height: 250px; overflow-y: auto; margin: 10px 0;";

    // Warning element for 20+ templates
    const warningEl = document.createElement("div");
    warningEl.style.cssText = "display: none; padding: 8px; margin-bottom: 8px; background: #fff3cd; color: #856404; border-radius: 4px; font-size: 0.85em;";
    warningEl.textContent = "You have many templates. Consider deleting unused ones to keep your list manageable.";

    const renderTemplates = async () => {
      const currentTemplates = await this._callBackgroundTask("getTemplates");
      listContainer.innerHTML = "";

      // Show warning if 20+ templates
      if (currentTemplates && currentTemplates.length >= 20) {
        warningEl.style.display = "block";
      } else {
        warningEl.style.display = "none";
      }

      if (!currentTemplates || currentTemplates.length === 0) {
        listContainer.innerHTML = '<div style="text-align: center; padding: 20px; opacity: 0.6;">No templates saved.<br><small>Save a workspace as a template using the "..." menu.</small></div>';
        return;
      }

      for (const template of currentTemplates) {
        const item = document.createElement("div");
        item.style.cssText = "padding: 8px; border-radius: 4px; margin-bottom: 4px; background: var(--button-bg); display: flex; align-items: center; gap: 8px;";

        // Color indicator
        if (template.color) {
          const colorDot = document.createElement("div");
          colorDot.style.cssText = `width: 12px; height: 12px; border-radius: 50%; background: ${template.color}; flex-shrink: 0;`;
          item.appendChild(colorDot);
        }

        // Name and tab count
        const info = document.createElement("div");
        info.style.cssText = "flex: 1; cursor: pointer;";
        const nameEl = document.createElement("div");
        nameEl.style.cssText = "font-size: 0.9em;";
        nameEl.textContent = template.name;
        info.appendChild(nameEl);

        const countEl = document.createElement("div");
        countEl.style.cssText = "font-size: 0.75em; opacity: 0.7;";
        countEl.textContent = `${template.tabs.length} tab(s)`;
        info.appendChild(countEl);
        item.appendChild(info);

        // Edit button
        const editBtn = document.createElement("a");
        editBtn.href = "#";
        editBtn.textContent = "✎";
        editBtn.style.cssText = "color: var(--text-popup); font-size: 1em; padding: 0 5px; text-decoration: none; opacity: 0.6;";
        editBtn.title = "Edit template";
        item.appendChild(editBtn);

        // Delete button
        const deleteBtn = document.createElement("a");
        deleteBtn.href = "#";
        deleteBtn.textContent = "×";
        deleteBtn.style.cssText = "color: #f44336; font-size: 1.2em; padding: 0 5px; text-decoration: none;";
        deleteBtn.title = "Delete template";
        item.appendChild(deleteBtn);

        // Click to create workspace from template
        info.addEventListener("click", async () => {
          const windowId = (await browser.windows.getCurrent()).id;
          const result = await this._callBackgroundTask("createFromTemplate", {
            templateId: template.id,
            windowId: windowId
          });

          if (result && result.success) {
            cleanup();
            window.close();
          } else {
            await showCustomDialog({ message: "Failed to create workspace from template." });
          }
        });

        // Hover effects
        info.addEventListener("mouseenter", () => {
          item.style.background = "var(--button-hover)";
        });
        info.addEventListener("mouseleave", () => {
          item.style.background = "var(--button-bg)";
        });

        // Edit template
        editBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          cleanup();
          await this._showEditTemplateDialog(template, renderTemplates);
        });

        // Delete template
        deleteBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const confirmed = await showCustomDialog({ message: `Delete template "${template.name}"?` });
          if (confirmed) {
            await this._callBackgroundTask("deleteTemplate", { templateId: template.id });
            await renderTemplates();
          }
        });

        listContainer.appendChild(item);
      }
    };

    await renderTemplates();

    // Insert warning before list
    msgEl.parentNode.insertBefore(warningEl, inputEl);

    // Insert list after message
    msgEl.parentNode.insertBefore(listContainer, inputEl);

    okBtn.hidden = true;
    cancelBtn.textContent = "Close";
    backdrop.classList.add("show");

    const cleanup = () => {
      backdrop.classList.remove("show");
      listContainer.remove();
      okBtn.hidden = false;
      okBtn.textContent = "OK";
      cancelBtn.textContent = "Cancel";
      cancelBtn.removeEventListener("click", onClose);
    };

    const onClose = () => {
      cleanup();
    };

    cancelBtn.addEventListener("click", onClose);
  }

  async _showEditTemplateDialog(template, onSaveCallback) {
    const backdrop = document.getElementById("custom-dialog-backdrop");
    const msgEl = document.getElementById("custom-dialog-message");
    const inputEl = document.getElementById("custom-dialog-input");
    const colorPicker = document.getElementById("custom-dialog-colors");
    const okBtn = document.getElementById("custom-dialog-ok");
    const cancelBtn = document.getElementById("custom-dialog-cancel");

    msgEl.innerHTML = `<strong>Edit Template</strong>`;
    inputEl.hidden = false;
    inputEl.value = template.name;
    colorPicker.hidden = false;

    // Select current color
    colorPicker.querySelectorAll(".color-option").forEach(opt => {
      opt.classList.remove("selected");
      if (opt.dataset.color === template.color) {
        opt.classList.add("selected");
      }
    });

    let selectedColor = template.color || "";

    // Create tabs list
    const tabsContainer = document.createElement("div");
    tabsContainer.style.cssText = "max-height: 150px; overflow-y: auto; margin: 10px 0; font-size: 0.85em;";

    const tabsLabel = document.createElement("div");
    tabsLabel.style.cssText = "font-weight: 500; margin-bottom: 5px;";
    tabsLabel.textContent = `Tabs (${template.tabs.length}):`;
    tabsContainer.appendChild(tabsLabel);

    const tabsList = document.createElement("div");
    tabsList.style.cssText = "background: var(--button-bg); border-radius: 4px; padding: 8px;";

    for (const tab of template.tabs) {
      const tabItem = document.createElement("div");
      tabItem.style.cssText = "padding: 4px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.8;";
      tabItem.textContent = tab.title || tab.url;
      tabItem.title = tab.url;
      tabsList.appendChild(tabItem);
    }
    tabsContainer.appendChild(tabsList);

    // Insert tabs list after color picker
    colorPicker.parentNode.insertBefore(tabsContainer, colorPicker.nextSibling);

    okBtn.hidden = false;
    okBtn.textContent = "Save";
    okBtn.disabled = false;
    cancelBtn.textContent = "Cancel";
    backdrop.classList.add("show");
    inputEl.focus();
    inputEl.select();

    const cleanup = () => {
      backdrop.classList.remove("show");
      tabsContainer.remove();
      okBtn.textContent = "OK";
      cancelBtn.textContent = "Cancel";
      inputEl.hidden = true;
      colorPicker.hidden = true;
      colorPicker.querySelectorAll(".color-option").forEach(opt => {
        opt.removeEventListener("click", onColorClick);
      });
      okBtn.removeEventListener("click", onSave);
      cancelBtn.removeEventListener("click", onCancel);
      inputEl.removeEventListener("input", updateOkState);
    };

    const updateOkState = () => {
      okBtn.disabled = inputEl.value.trim().length === 0;
    };

    const onColorClick = (e) => {
      selectedColor = e.target.dataset.color;
      colorPicker.querySelectorAll(".color-option").forEach(opt => opt.classList.remove("selected"));
      e.target.classList.add("selected");
    };

    const onSave = async () => {
      const newName = inputEl.value.trim();
      if (!newName) return;

      await this._callBackgroundTask("updateTemplate", {
        templateId: template.id,
        updates: { name: newName, color: selectedColor }
      });

      cleanup();
      // Reopen templates dialog
      await this._showTemplatesDialog();
    };

    const onCancel = () => {
      cleanup();
      // Reopen templates dialog
      this._showTemplatesDialog();
    };

    inputEl.addEventListener("input", updateOkState);
    colorPicker.querySelectorAll(".color-option").forEach(opt => {
      opt.addEventListener("click", onColorClick);
    });
    okBtn.addEventListener("click", onSave);
    cancelBtn.addEventListener("click", onCancel);
  }

  async _showSettingsDialog() {
    const settings = await this._callBackgroundTask("getSettings");

    const backdrop = document.getElementById("custom-dialog-backdrop");
    const msgEl = document.getElementById("custom-dialog-message");
    const inputEl = document.getElementById("custom-dialog-input");
    const colorPicker = document.getElementById("custom-dialog-colors");
    const okBtn = document.getElementById("custom-dialog-ok");
    const cancelBtn = document.getElementById("custom-dialog-cancel");

    msgEl.innerHTML = `<strong>Settings</strong>`;
    inputEl.hidden = true;
    colorPicker.hidden = true;

    // Create settings form
    const settingsContainer = document.createElement("div");
    settingsContainer.className = "settings-dialog";
    settingsContainer.style.cssText = "margin: 15px 0;";

    const tabLimitSection = document.createElement("div");
    tabLimitSection.className = "settings-section";

    const tabLimitRow = document.createElement("div");
    tabLimitRow.className = "settings-row";

    const tabLimitLabel = document.createElement("label");
    tabLimitLabel.htmlFor = "tab-limit-input";
    tabLimitLabel.textContent = "Tab limit per workspace:";
    tabLimitRow.appendChild(tabLimitLabel);

    const tabLimitInput = document.createElement("input");
    tabLimitInput.type = "number";
    tabLimitInput.id = "tab-limit-input";
    tabLimitInput.min = "0";
    tabLimitInput.max = "999";
    tabLimitInput.value = String(settings.tabLimit || 0);
    tabLimitRow.appendChild(tabLimitInput);

    const tabLimitHint = document.createElement("div");
    tabLimitHint.className = "settings-hint";
    tabLimitHint.textContent = "Set to 0 for no limit. Warning appears when exceeded.";

    tabLimitSection.appendChild(tabLimitRow);
    tabLimitSection.appendChild(tabLimitHint);
    settingsContainer.appendChild(tabLimitSection);

    const autoDeleteSection = document.createElement("div");
    autoDeleteSection.className = "settings-section";
    autoDeleteSection.style.marginTop = "12px";

    const autoDeleteRow = document.createElement("div");
    autoDeleteRow.className = "settings-row";

    const autoDeleteLabel = document.createElement("label");
    autoDeleteLabel.htmlFor = "auto-delete-empty-input";
    autoDeleteLabel.textContent = "Automatically delete empty workspaces:";
    autoDeleteRow.appendChild(autoDeleteLabel);

    const autoDeleteEmptyInput = document.createElement("input");
    autoDeleteEmptyInput.type = "checkbox";
    autoDeleteEmptyInput.id = "auto-delete-empty-input";
    autoDeleteEmptyInput.checked = !!settings.autoDeleteEmptyWorkspaces;
    autoDeleteRow.appendChild(autoDeleteEmptyInput);

    const autoDeleteHint = document.createElement("div");
    autoDeleteHint.className = "settings-hint";
    autoDeleteHint.textContent = "When enabled, non-pinned workspaces are deleted when their last tab closes.";

    autoDeleteSection.appendChild(autoDeleteRow);
    autoDeleteSection.appendChild(autoDeleteHint);
    settingsContainer.appendChild(autoDeleteSection);

    const autoArchiveSection = document.createElement("div");
    autoArchiveSection.className = "settings-section";
    autoArchiveSection.style.marginTop = "12px";

    const autoArchiveRow = document.createElement("div");
    autoArchiveRow.className = "settings-row";

    const autoArchiveLabel = document.createElement("label");
    autoArchiveLabel.htmlFor = "auto-archive-enabled-input";
    autoArchiveLabel.textContent = "Auto-archive inactive workspaces:";
    autoArchiveRow.appendChild(autoArchiveLabel);

    const autoArchiveEnabledInput = document.createElement("input");
    autoArchiveEnabledInput.type = "checkbox";
    autoArchiveEnabledInput.id = "auto-archive-enabled-input";
    autoArchiveEnabledInput.checked = !!settings.autoArchiveEnabled;
    autoArchiveRow.appendChild(autoArchiveEnabledInput);

    const autoArchiveDaysRow = document.createElement("div");
    autoArchiveDaysRow.className = "settings-row";
    autoArchiveDaysRow.style.marginTop = "6px";

    const autoArchiveDaysLabel = document.createElement("label");
    autoArchiveDaysLabel.htmlFor = "auto-archive-days-input";
    autoArchiveDaysLabel.textContent = "Archive after (days):";
    autoArchiveDaysRow.appendChild(autoArchiveDaysLabel);

    const autoArchiveDaysInput = document.createElement("input");
    autoArchiveDaysInput.type = "number";
    autoArchiveDaysInput.id = "auto-archive-days-input";
    autoArchiveDaysInput.min = "1";
    autoArchiveDaysInput.max = "3650";
    autoArchiveDaysInput.value = String(settings.autoArchiveAfterDays || 30);
    autoArchiveDaysRow.appendChild(autoArchiveDaysInput);

    const autoArchiveHint = document.createElement("div");
    autoArchiveHint.className = "settings-hint";
    autoArchiveHint.textContent = "Automatically hides non-pinned workspaces not activated in N days (recoverable via \"> archived\").";

    const updateAutoArchiveControls = () => {
      autoArchiveDaysInput.disabled = !autoArchiveEnabledInput.checked;
    };
    autoArchiveEnabledInput.addEventListener("change", updateAutoArchiveControls);
    updateAutoArchiveControls();

    autoArchiveSection.appendChild(autoArchiveRow);
    autoArchiveSection.appendChild(autoArchiveDaysRow);
    autoArchiveSection.appendChild(autoArchiveHint);
    settingsContainer.appendChild(autoArchiveSection);

    const debugSection = document.createElement("div");
    debugSection.className = "settings-section";
    debugSection.style.marginTop = "12px";

    const debugRow = document.createElement("div");
    debugRow.className = "settings-row";

    const debugLabel = document.createElement("label");
    debugLabel.htmlFor = "debug-mode-input";
    debugLabel.textContent = "Enable diagnostics logging:";
    debugRow.appendChild(debugLabel);

    const debugInput = document.createElement("input");
    debugInput.type = "checkbox";
    debugInput.id = "debug-mode-input";
    debugInput.checked = !!settings?.debug;
    debugRow.appendChild(debugInput);

    const debugHint = document.createElement("div");
    debugHint.className = "settings-hint";
    debugHint.textContent = "Enables console timings/logs and allows copying diagnostics for bug reports.";

    debugSection.appendChild(debugRow);
    debugSection.appendChild(debugHint);
    settingsContainer.appendChild(debugSection);

    const diagnosticsSection = document.createElement("div");
    diagnosticsSection.className = "settings-section";
    diagnosticsSection.style.marginTop = "12px";

    const diagnosticsRow = document.createElement("div");
    diagnosticsRow.className = "settings-row";

    const diagnosticsLabel = document.createElement("label");
    diagnosticsLabel.textContent = "Diagnostics:";
    diagnosticsRow.appendChild(diagnosticsLabel);

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", async () => {
      const original = copyBtn.textContent;
      copyBtn.disabled = true;
      copyBtn.textContent = "Copying...";

      try {
        const diagnostics = await this._callBackgroundTask("getDiagnostics");
        const payload = {
          ...(diagnostics || {}),
          popup: {
            windowId: this.currentWindowId,
            loadedWorkspaces: this.workspaces.length,
            loadedTabs: this.allTabs.length
          }
        };

        const ok = await this._copyToClipboard(JSON.stringify(payload, null, 2));
        copyBtn.textContent = ok ? "Copied" : "Failed";
      } catch (e) {
        console.warn("Failed to copy diagnostics:", e);
        copyBtn.textContent = "Failed";
      } finally {
        setTimeout(() => {
          copyBtn.textContent = original;
          copyBtn.disabled = false;
        }, 900);
      }
    });
    diagnosticsRow.appendChild(copyBtn);

    const diagnosticsHint = document.createElement("div");
    diagnosticsHint.className = "settings-hint";
    diagnosticsHint.textContent = "Copies JSON with extension version, workspace/tab counts, and last error.";

    diagnosticsSection.appendChild(diagnosticsRow);
    diagnosticsSection.appendChild(diagnosticsHint);
    settingsContainer.appendChild(diagnosticsSection);

    // Insert settings after message
    msgEl.parentNode.insertBefore(settingsContainer, inputEl);

    okBtn.hidden = false;
    okBtn.textContent = "Save";
    cancelBtn.textContent = "Cancel";
    backdrop.classList.add("show");

    const cleanup = () => {
      backdrop.classList.remove("show");
      settingsContainer.remove();
      okBtn.textContent = "OK";
      cancelBtn.textContent = "Cancel";
      okBtn.removeEventListener("click", onSave);
      cancelBtn.removeEventListener("click", onCancel);
    };

    const onSave = async () => {
      const newTabLimit = parseInt(tabLimitInput.value) || 0;
      const autoDeleteEmptyWorkspaces = !!autoDeleteEmptyInput?.checked;
      const autoArchiveEnabled = !!autoArchiveEnabledInput?.checked;
      const autoArchiveAfterDays = Math.max(0, parseInt(autoArchiveDaysInput.value) || 0);
      const debug = !!debugInput?.checked;

      // Save settings
      await this._callBackgroundTask("saveSettings", {
        settings: {
          ...(settings || {}),
          tabLimit: newTabLimit,
          showTabLimitWarning: true,
          autoDeleteEmptyWorkspaces,
          autoArchiveEnabled,
          autoArchiveAfterDays,
          debug
        }
      });

      await this._callBackgroundTask("runAutoArchiveNow").catch(() => {});

      this.tabLimit = newTabLimit;
      this.debug = debug;
      cleanup();

      // Refresh the workspace list to update warnings
      document.getElementById("wsp-list").innerHTML = "";
      this.displayWorkspaces();
    };

    const onCancel = () => {
      cleanup();
    };

    okBtn.addEventListener("click", onSave);
    cancelBtn.addEventListener("click", onCancel);
  }

  async _showArchivedWorkspacesDialog() {
    const backdrop = document.getElementById("custom-dialog-backdrop");
    const msgEl = document.getElementById("custom-dialog-message");
    const inputEl = document.getElementById("custom-dialog-input");
    const colorPicker = document.getElementById("custom-dialog-colors");
    const okBtn = document.getElementById("custom-dialog-ok");
    const cancelBtn = document.getElementById("custom-dialog-cancel");

    msgEl.replaceChildren();
    const titleEl = document.createElement("strong");
    titleEl.textContent = "Archived workspaces";
    msgEl.appendChild(titleEl);
    msgEl.appendChild(document.createElement("br"));
    const subtitle = document.createElement("small");
    subtitle.textContent = "Restore or activate an archived workspace.";
    msgEl.appendChild(subtitle);

    inputEl.hidden = true;
    colorPicker.hidden = true;

    const listContainer = document.createElement("div");
    listContainer.style.cssText = "max-height: 260px; overflow-y: auto; margin: 12px 0; display: flex; flex-direction: column; gap: 6px;";

    const formatLastActive = (ts) => {
      const value = Number(ts);
      if (!Number.isFinite(value)) return "unknown";
      try {
        return new Date(value).toLocaleString();
      } catch (_) {
        return "unknown";
      }
    };

    const render = () => {
      listContainer.replaceChildren();

      const list = this.workspaces.filter(w => !!w.archived);
      if (list.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = "padding: 12px; text-align: center; opacity: 0.7;";
        empty.textContent = "No archived workspaces.";
        listContainer.appendChild(empty);
        return;
      }

      for (const wsp of list) {
        const row = document.createElement("div");
        row.style.cssText = "display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 6px; background: var(--button-bg); border: 1px solid var(--border-popup);";

        const info = document.createElement("div");
        info.style.cssText = "flex: 1; overflow: hidden;";

        const nameEl = document.createElement("div");
        nameEl.style.cssText = "font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
        nameEl.textContent = wsp.name || "Unnamed Workspace";
        info.appendChild(nameEl);

        const metaEl = document.createElement("div");
        metaEl.style.cssText = "font-size: 0.8em; opacity: 0.75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
        const tabCount = Array.isArray(wsp.tabs) ? wsp.tabs.length : 0;
        metaEl.textContent = `${tabCount} tab(s) • last active: ${formatLastActive(wsp.lastActivatedAt)}`;
        info.appendChild(metaEl);

        row.appendChild(info);

        const restoreBtn = document.createElement("button");
        restoreBtn.type = "button";
        restoreBtn.textContent = "Restore";
        restoreBtn.addEventListener("click", async () => {
          const result = await this._callBackgroundTask("updateWorkspace", { wspId: wsp.id, archived: false });
          const err = this._getBackgroundError(result);
          if (err) {
            await showCustomDialog({ message: `Failed to restore workspace: ${err}` });
            return;
          }

          wsp.archived = false;
          document.getElementById("wsp-list").innerHTML = "";
          this.displayWorkspaces();
          render();
        });
        row.appendChild(restoreBtn);

        const activateBtn = document.createElement("button");
        activateBtn.type = "button";
        activateBtn.textContent = "Activate";
        activateBtn.addEventListener("click", async () => {
          await this._callBackgroundTask("activateWorkspace", { wspId: wsp.id, windowId: wsp.windowId });
          window.close();
        });
        row.appendChild(activateBtn);

        listContainer.appendChild(row);
      }
    };

    render();

    msgEl.parentNode.insertBefore(listContainer, inputEl);

    okBtn.hidden = true;
    cancelBtn.textContent = "Close";
    backdrop.classList.add("show");

    const cleanup = () => {
      backdrop.classList.remove("show");
      listContainer.remove();
      okBtn.hidden = false;
      okBtn.textContent = "OK";
      cancelBtn.textContent = "Cancel";
      cancelBtn.removeEventListener("click", onClose);
    };

    const onClose = () => cleanup();

    cancelBtn.addEventListener("click", onClose);
  }

  async _showWorkspaceRulesDialog() {
    const backdrop = document.getElementById("custom-dialog-backdrop");
    const msgEl = document.getElementById("custom-dialog-message");
    const inputEl = document.getElementById("custom-dialog-input");
    const colorPicker = document.getElementById("custom-dialog-colors");
    const okBtn = document.getElementById("custom-dialog-ok");
    const cancelBtn = document.getElementById("custom-dialog-cancel");

    const existingRules = await this._callBackgroundTask("getRules").catch(() => []);
    const draftRules = Array.isArray(existingRules)
      ? existingRules.map(r => ({
        id: (r?.id || "").toString(),
        enabled: r?.enabled !== false,
        matchType: (r?.matchType || "domain").toString(),
        pattern: (r?.pattern || "").toString(),
        targetWorkspaceName: (r?.targetWorkspaceName || "").toString(),
      }))
      : [];

    msgEl.replaceChildren();
    const titleEl = document.createElement("strong");
    titleEl.textContent = "Workspace rules";
    msgEl.appendChild(titleEl);
    msgEl.appendChild(document.createElement("br"));
    const subtitle = document.createElement("small");
    subtitle.textContent = "Auto-assign newly created tabs. First matching enabled rule wins.";
    msgEl.appendChild(subtitle);

    inputEl.hidden = true;
    colorPicker.hidden = true;

    const container = document.createElement("div");
    container.className = "settings-dialog";
    container.style.cssText = "margin: 12px 0;";

    const errorEl = document.createElement("div");
    errorEl.style.cssText = "display: none; padding: 8px; margin-bottom: 8px; background: rgba(244, 67, 54, 0.15); border: 1px solid rgba(244, 67, 54, 0.35); border-radius: 6px; font-size: 0.85em;";
    container.appendChild(errorEl);

    const helpEl = document.createElement("div");
    helpEl.style.cssText = "margin-bottom: 10px; font-size: 0.85em; opacity: 0.85;";
    helpEl.textContent = "Patterns use * as a wildcard. Domain rules match subdomains (e.g. \"github.com\" matches \"docs.github.com\").";
    container.appendChild(helpEl);

    const controlsRow = document.createElement("div");
    controlsRow.style.cssText = "display: flex; gap: 8px; align-items: center; margin-bottom: 10px;";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "+ Add rule";
    controlsRow.appendChild(addBtn);

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.textContent = "Clear all";
    clearBtn.style.opacity = "0.8";
    controlsRow.appendChild(clearBtn);

    container.appendChild(controlsRow);

	    const workspaceNames = Array.from(new Set(
	      this.workspaces
	        .filter(w => !w.archived && w.snoozedUntil == null)
	        .map(w => (w?.name || "").toString().trim())
	        .filter(Boolean)
	    )).sort((a, b) => a.localeCompare(b));

    const datalistId = "wsp-rules-workspace-names";
    const datalist = document.createElement("datalist");
    datalist.id = datalistId;
    for (const name of workspaceNames) {
      const opt = document.createElement("option");
      opt.value = name;
      datalist.appendChild(opt);
    }
    container.appendChild(datalist);

    const listEl = document.createElement("div");
    listEl.style.cssText = "display: flex; flex-direction: column; gap: 8px;";
    container.appendChild(listEl);

    const allowedTypes = [
      { value: "domain", label: "Domain" },
      { value: "path", label: "Path" },
      { value: "title", label: "Title" },
      { value: "url", label: "URL" },
    ];

    const makeRuleId = () => `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const showError = (message) => {
      const text = (message || "").toString().trim();
      if (!text) {
        errorEl.style.display = "none";
        errorEl.textContent = "";
        return;
      }
      errorEl.textContent = text;
      errorEl.style.display = "";
    };

    const validate = () => {
      for (const [index, rule] of draftRules.entries()) {
        if (!rule?.id || !String(rule.id).trim()) {
          return `Rule #${index + 1} is missing an id.`;
        }
        if (!String(rule.pattern || "").trim()) {
          return `Rule #${index + 1} is missing a pattern.`;
        }
        if (!String(rule.targetWorkspaceName || "").trim()) {
          return `Rule #${index + 1} is missing a target workspace name.`;
        }
      }
      return null;
    };

    const render = () => {
      listEl.replaceChildren();

      if (draftRules.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = "padding: 12px; text-align: center; opacity: 0.7; border: 1px dashed var(--border-popup); border-radius: 6px;";
        empty.textContent = "No rules yet.";
        listEl.appendChild(empty);
        return;
      }

      draftRules.forEach((rule, index) => {
        const card = document.createElement("div");
        card.style.cssText = "background: var(--button-bg); border: 1px solid var(--border-popup); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px;";

        const topRow = document.createElement("div");
        topRow.style.cssText = "display: flex; gap: 8px; align-items: center;";

        const enabledInput = document.createElement("input");
        enabledInput.type = "checkbox";
        enabledInput.checked = rule.enabled !== false;
        enabledInput.title = "Enable rule";
        enabledInput.addEventListener("change", () => {
          rule.enabled = !!enabledInput.checked;
        });
        topRow.appendChild(enabledInput);

        const typeSelect = document.createElement("select");
        typeSelect.style.cssText = "flex: 0 0 110px;";
        for (const t of allowedTypes) {
          const opt = document.createElement("option");
          opt.value = t.value;
          opt.textContent = t.label;
          typeSelect.appendChild(opt);
        }
        typeSelect.value = rule.matchType || "domain";
        typeSelect.addEventListener("change", () => {
          rule.matchType = typeSelect.value;
        });
        topRow.appendChild(typeSelect);

        const upBtn = document.createElement("button");
        upBtn.type = "button";
        upBtn.textContent = "↑";
        upBtn.title = "Move up";
        upBtn.disabled = index === 0;
        upBtn.addEventListener("click", () => {
          if (index <= 0) return;
          const [item] = draftRules.splice(index, 1);
          draftRules.splice(index - 1, 0, item);
          render();
        });
        topRow.appendChild(upBtn);

        const downBtn = document.createElement("button");
        downBtn.type = "button";
        downBtn.textContent = "↓";
        downBtn.title = "Move down";
        downBtn.disabled = index === draftRules.length - 1;
        downBtn.addEventListener("click", () => {
          if (index >= draftRules.length - 1) return;
          const [item] = draftRules.splice(index, 1);
          draftRules.splice(index + 1, 0, item);
          render();
        });
        topRow.appendChild(downBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.textContent = "Delete";
        deleteBtn.style.cssText = "margin-left: auto; background: rgba(244, 67, 54, 0.15); border: 1px solid rgba(244, 67, 54, 0.35);";
        deleteBtn.addEventListener("click", () => {
          draftRules.splice(index, 1);
          render();
        });
        topRow.appendChild(deleteBtn);

        card.appendChild(topRow);

        const patternRow = document.createElement("div");
        patternRow.style.cssText = "display: flex; gap: 8px; align-items: center;";

        const patternLabel = document.createElement("div");
        patternLabel.style.cssText = "flex: 0 0 110px; font-size: 0.85em; opacity: 0.8;";
        patternLabel.textContent = "Pattern";
        patternRow.appendChild(patternLabel);

        const patternInput = document.createElement("input");
        patternInput.type = "text";
        patternInput.value = rule.pattern || "";
        patternInput.placeholder = rule.matchType === "domain" ? "github.com" : "*";
        patternInput.style.cssText = "flex: 1;";
        patternInput.addEventListener("input", () => {
          rule.pattern = patternInput.value;
        });
        patternRow.appendChild(patternInput);

        card.appendChild(patternRow);

        const targetRow = document.createElement("div");
        targetRow.style.cssText = "display: flex; gap: 8px; align-items: center;";

        const targetLabel = document.createElement("div");
        targetLabel.style.cssText = "flex: 0 0 110px; font-size: 0.85em; opacity: 0.8;";
        targetLabel.textContent = "Target";
        targetRow.appendChild(targetLabel);

        const targetInput = document.createElement("input");
        targetInput.type = "text";
        targetInput.value = rule.targetWorkspaceName || "";
        targetInput.placeholder = "Workspace name (creates if missing)";
        targetInput.setAttribute("list", datalistId);
        targetInput.style.cssText = "flex: 1;";
        targetInput.addEventListener("input", () => {
          rule.targetWorkspaceName = targetInput.value;
        });
        targetRow.appendChild(targetInput);

        card.appendChild(targetRow);

        listEl.appendChild(card);
      });
    };

    const addRule = () => {
      draftRules.push({
        id: makeRuleId(),
        enabled: true,
        matchType: "domain",
        pattern: "",
        targetWorkspaceName: ""
      });
      render();
      showError("");
    };

    let clearArmed = false;
    const resetClear = () => {
      clearArmed = false;
      clearBtn.textContent = "Clear all";
    };

    const onClearClick = () => {
      if (!clearArmed) {
        clearArmed = true;
        clearBtn.textContent = "Confirm clear";
        setTimeout(() => {
          if (clearArmed) resetClear();
        }, 1600);
        return;
      }

      resetClear();
      draftRules.splice(0, draftRules.length);
      render();
      showError("");
    };

    addBtn.addEventListener("click", addRule);
    clearBtn.addEventListener("click", onClearClick);

    render();

    msgEl.parentNode.insertBefore(container, inputEl);

    okBtn.hidden = false;
    okBtn.textContent = "Save";
    cancelBtn.textContent = "Cancel";
    backdrop.classList.add("show");

    const cleanup = () => {
      backdrop.classList.remove("show");
      container.remove();
      okBtn.textContent = "OK";
      cancelBtn.textContent = "Cancel";
      okBtn.removeEventListener("click", onSave);
      cancelBtn.removeEventListener("click", onCancel);
      addBtn.removeEventListener("click", addRule);
      clearBtn.removeEventListener("click", onClearClick);
    };

    const onSave = async () => {
      showError("");
      const validationError = validate();
      if (validationError) {
        showError(validationError);
        return;
      }

      const result = await this._callBackgroundTask("saveRules", { rules: draftRules }).catch((e) => ({
        success: false,
        error: e?.message ? String(e.message) : String(e)
      }));

      const err = this._getBackgroundError(result);
      if (err) {
        showError(`Failed to save rules: ${err}`);
        return;
      }

      cleanup();
    };

    const onCancel = () => cleanup();

    okBtn.addEventListener("click", onSave);
    cancelBtn.addEventListener("click", onCancel);
  }

  async _showTagsDialog(workspace) {
    const backdrop = document.getElementById("custom-dialog-backdrop");
    const msgEl = document.getElementById("custom-dialog-message");
    const inputEl = document.getElementById("custom-dialog-input");
    const colorPicker = document.getElementById("custom-dialog-colors");
    const okBtn = document.getElementById("custom-dialog-ok");
    const cancelBtn = document.getElementById("custom-dialog-cancel");

    const currentTags = Array.isArray(workspace?.tags) ? workspace.tags : [];

    msgEl.innerHTML = `<strong>Tags</strong><br><small>Comma-separated (leave empty to clear)</small>`;
    const errorEl = document.createElement("div");
    errorEl.style.cssText = "margin-top: 8px; font-size: 0.8em; color: #f44336; display: none;";
    msgEl.appendChild(errorEl);
    inputEl.hidden = false;
    inputEl.value = currentTags.join(", ");
    colorPicker.hidden = true;

    okBtn.hidden = false;
    okBtn.textContent = "Save";
    okBtn.disabled = false;
    cancelBtn.textContent = "Cancel";
    backdrop.classList.add("show");
    inputEl.focus();
    inputEl.select();

    const cleanup = () => {
      backdrop.classList.remove("show");
      okBtn.textContent = "OK";
      cancelBtn.textContent = "Cancel";
      inputEl.hidden = true;
      okBtn.removeEventListener("click", onSave);
      cancelBtn.removeEventListener("click", onCancel);
      inputEl.removeEventListener("keydown", onKeyDown);
    };

    const parseTags = (value) => {
      const raw = (value || "").toString();
      return raw
        .split(",")
        .map(t => t.trim())
        .filter(Boolean);
    };

    const onSave = async () => {
      errorEl.style.display = "none";
      const tags = parseTags(inputEl.value);
      const result = await this._callBackgroundTask("updateWorkspace", { wspId: workspace.id, tags });
      const err = this._getBackgroundError(result);
      if (err) {
        errorEl.textContent = `Failed to save tags: ${err}`;
        errorEl.style.display = "";
        return;
      }
      workspace.tags = tags;
      await this._loadAllTabs();
      cleanup();
    };

    const onCancel = () => {
      cleanup();
    };

    const onKeyDown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };

    okBtn.addEventListener("click", onSave);
    cancelBtn.addEventListener("click", onCancel);
    inputEl.addEventListener("keydown", onKeyDown);
  }

  async _copyToClipboard(text) {
    const value = text == null ? "" : String(text);

    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (e) {
      // Fallback for older contexts
      try {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.top = "-1000px";
        textarea.style.left = "-1000px";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        textarea.remove();
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }

  async _showRecentlyClosedDialog(workspace, closedTabs) {
    // Create a simple list dialog
    const backdrop = document.getElementById("custom-dialog-backdrop");
    const msgEl = document.getElementById("custom-dialog-message");
    const inputEl = document.getElementById("custom-dialog-input");
    const colorPicker = document.getElementById("custom-dialog-colors");
    const okBtn = document.getElementById("custom-dialog-ok");
    const cancelBtn = document.getElementById("custom-dialog-cancel");

    msgEl.replaceChildren();
    const titleEl = document.createElement("strong");
    titleEl.textContent = `Recently Closed in "${workspace.name}"`;
    msgEl.appendChild(titleEl);
    msgEl.appendChild(document.createElement("br"));
    const subtitleEl = document.createElement("small");
    subtitleEl.textContent = "Click to restore";
    msgEl.appendChild(subtitleEl);
    inputEl.hidden = true;
    colorPicker.hidden = true;

    // Create list of closed tabs
    const listContainer = document.createElement("div");
    listContainer.className = "recently-closed-list";
    listContainer.style.cssText = "max-height: 200px; overflow-y: auto; margin: 10px 0;";

    closedTabs.forEach((tab, index) => {
      const item = document.createElement("div");
      item.style.cssText = "padding: 8px; cursor: pointer; border-radius: 4px; margin-bottom: 4px; background: var(--button-bg);";
      const title = document.createElement("div");
      title.style.cssText = "font-size: 0.9em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
      title.textContent = tab.title;
      item.appendChild(title);
      item.title = tab.url;

      item.addEventListener("mouseenter", () => {
        item.style.background = "var(--button-hover)";
      });
      item.addEventListener("mouseleave", () => {
        item.style.background = "var(--button-bg)";
      });

      item.addEventListener("click", async () => {
        const result = await this._callBackgroundTask("restoreRecentlyClosed", {
          wspId: workspace.id,
          index: index
        });

        if (result && result.success) {
          // Refresh the list
          const newClosedTabs = await this._callBackgroundTask("getRecentlyClosed", { wspId: workspace.id });
          if (newClosedTabs && newClosedTabs.length > 0) {
            // Rebuild list
            listContainer.innerHTML = "";
            this._showRecentlyClosedDialog(workspace, newClosedTabs);
          } else {
            backdrop.classList.remove("show");
            listContainer.remove();
          }
          await this._loadAllTabs();
        }
      });

      listContainer.appendChild(item);
    });

    // Insert list after message
    msgEl.parentNode.insertBefore(listContainer, inputEl);

    okBtn.textContent = "Clear All";
    cancelBtn.textContent = "Close";
    backdrop.classList.add("show");

    const cleanup = () => {
      backdrop.classList.remove("show");
      listContainer.remove();
      okBtn.textContent = "OK";
      cancelBtn.textContent = "Cancel";
      okBtn.removeEventListener("click", onClearAll);
      cancelBtn.removeEventListener("click", onClose);
    };

    const onClearAll = async () => {
      await this._callBackgroundTask("clearRecentlyClosed", { wspId: workspace.id });
      cleanup();
    };

    const onClose = () => {
      cleanup();
    };

    okBtn.addEventListener("click", onClearAll);
    cancelBtn.addEventListener("click", onClose);
  }

  async _showDuplicateCleanupDialog({ scope = "active-workspace" } = {}) {
    const backdrop = document.getElementById("custom-dialog-backdrop");
    const msgEl = document.getElementById("custom-dialog-message");
    const inputEl = document.getElementById("custom-dialog-input");
    const colorPicker = document.getElementById("custom-dialog-colors");
    const okBtn = document.getElementById("custom-dialog-ok");
    const cancelBtn = document.getElementById("custom-dialog-cancel");

    inputEl.hidden = true;
    colorPicker.hidden = true;

    const activeWorkspace = this._getActiveWorkspace();
    let selectedScope = scope === "window" ? "window" : "active-workspace";
    if (selectedScope === "active-workspace" && !activeWorkspace) {
      selectedScope = "window";
    }

    // Refresh tab cache so preview is accurate.
    await this._loadAllTabs();

    msgEl.replaceChildren();
    const titleEl = document.createElement("strong");
    titleEl.textContent = "Close duplicates";
    msgEl.appendChild(titleEl);
    msgEl.appendChild(document.createElement("br"));
    const subtitleEl = document.createElement("small");
    subtitleEl.textContent = "Preview duplicate groups and close duplicates by normalized URL.";
    msgEl.appendChild(subtitleEl);

    const container = document.createElement("div");
    container.className = "settings-dialog";
    container.style.cssText = "margin: 15px 0;";

    const optionsSection = document.createElement("div");
    optionsSection.className = "settings-section";

    const scopeRow = document.createElement("div");
    scopeRow.className = "settings-row";
    const scopeLabel = document.createElement("label");
    scopeLabel.textContent = "Scope:";
    scopeRow.appendChild(scopeLabel);

    const scopeSelect = document.createElement("select");
    scopeSelect.style.cssText = "padding: 6px 8px; border: 1px solid var(--border-popup); border-radius: 4px; background-color: var(--input-bg); color: var(--input-text);";
    const optWorkspace = document.createElement("option");
    optWorkspace.value = "active-workspace";
    optWorkspace.textContent = activeWorkspace ? `Active workspace (“${activeWorkspace.name || "Unnamed"}”)` : "Active workspace";
    optWorkspace.disabled = !activeWorkspace;
    const optWindow = document.createElement("option");
    optWindow.value = "window";
    optWindow.textContent = "Entire window";
    scopeSelect.appendChild(optWorkspace);
    scopeSelect.appendChild(optWindow);
    scopeSelect.value = selectedScope;
    scopeRow.appendChild(scopeSelect);
    optionsSection.appendChild(scopeRow);

    const ignoreHashRow = document.createElement("div");
    ignoreHashRow.className = "settings-row";
    const ignoreHashLabel = document.createElement("label");
    ignoreHashLabel.textContent = "Ignore URL hash (#...)";
    ignoreHashRow.appendChild(ignoreHashLabel);
    const ignoreHashInput = document.createElement("input");
    ignoreHashInput.type = "checkbox";
    ignoreHashInput.checked = true;
    ignoreHashRow.appendChild(ignoreHashInput);
    optionsSection.appendChild(ignoreHashRow);

    const ignoreQueryRow = document.createElement("div");
    ignoreQueryRow.className = "settings-row";
    const ignoreQueryLabel = document.createElement("label");
    ignoreQueryLabel.textContent = "Ignore query (?a=b)";
    ignoreQueryRow.appendChild(ignoreQueryLabel);
    const ignoreQueryInput = document.createElement("input");
    ignoreQueryInput.type = "checkbox";
    ignoreQueryInput.checked = false;
    ignoreQueryRow.appendChild(ignoreQueryInput);
    optionsSection.appendChild(ignoreQueryRow);

    const summary = document.createElement("div");
    summary.className = "settings-hint";
    summary.textContent = "Calculating…";
    optionsSection.appendChild(summary);

    container.appendChild(optionsSection);

    const listContainer = document.createElement("div");
    listContainer.style.cssText = "max-height: 240px; overflow-y: auto; margin-top: 10px;";
    container.appendChild(listContainer);

    const compute = () => {
      const ignoreHash = !!ignoreHashInput.checked;
      const ignoreQuery = !!ignoreQueryInput.checked;

      const scopeValue = scopeSelect.value;
      selectedScope = scopeValue === "window" ? "window" : "active-workspace";

      let tabs = this.allTabs;
      let label = "this window";

      if (selectedScope === "active-workspace" && activeWorkspace) {
        tabs = this.allTabs.filter(t => t.wspId === activeWorkspace.id);
        label = `“${activeWorkspace.name || "Unnamed"}”`;
      }

      const byKey = new Map();
      for (const tab of tabs) {
        const key = this._getDuplicateUrlKey(tab?.url, { ignoreHash, ignoreQuery });
        if (!key) continue;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(tab);
      }

      const groups = [];
      for (const [key, groupTabs] of byKey.entries()) {
        if (groupTabs.length < 2) continue;

        const keepId = groupTabs.find(t => t.active)?.tabId || groupTabs.find(t => t.pinned)?.tabId || groupTabs[0].tabId;
        const closable = groupTabs.filter(t => t.tabId !== keepId && !t.pinned);
        if (closable.length === 0) continue;

        groups.push({
          key,
          keepId,
          tabs: groupTabs,
          closeIds: closable.map(t => t.tabId),
        });
      }

      groups.sort((a, b) => (b.tabs.length - a.tabs.length) || a.key.localeCompare(b.key));
      const closeCount = groups.reduce((sum, g) => sum + g.closeIds.length, 0);

      return { groups, closeCount, label };
    };

    const render = () => {
      const { groups, closeCount, label } = compute();

      okBtn.disabled = closeCount === 0;
      summary.textContent = closeCount === 0
        ? `No closable duplicates found in ${label}.`
        : `Found ${groups.length} group(s), ${closeCount} tab(s) to close in ${label}.`;

      listContainer.replaceChildren();
      if (groups.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = "padding: 12px; opacity: 0.7; text-align: center;";
        empty.textContent = "No duplicates found.";
        listContainer.appendChild(empty);
        return;
      }

      for (const group of groups) {
        const box = document.createElement("div");
        box.style.cssText = "background: var(--button-bg); border-radius: 6px; padding: 10px; margin-bottom: 8px; border: 1px solid var(--border-popup);";

        const header = document.createElement("div");
        header.style.cssText = "display: flex; gap: 8px; align-items: center; margin-bottom: 6px;";

        const urlEl = document.createElement("div");
        urlEl.style.cssText = "font-size: 0.8em; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;";
        urlEl.textContent = group.key;
        urlEl.title = group.key;
        header.appendChild(urlEl);

        const countEl = document.createElement("div");
        countEl.style.cssText = "font-size: 0.75em; background: var(--button-primary); color: var(--button-primary-text); padding: 2px 6px; border-radius: 3px;";
        countEl.textContent = `${group.closeIds.length} close`;
        header.appendChild(countEl);

        box.appendChild(header);

        const items = document.createElement("div");
        items.style.cssText = "display: flex; flex-direction: column; gap: 4px;";

        for (const tab of group.tabs) {
          const row = document.createElement("div");
          row.style.cssText = "display: flex; gap: 8px; align-items: center; font-size: 0.78em; opacity: 0.92;";

          const badge = document.createElement("span");
          badge.style.cssText = "min-width: 52px; text-align: center; font-size: 0.72em; padding: 2px 6px; border-radius: 3px;";

          if (tab.tabId === group.keepId) {
            badge.textContent = "KEEP";
            badge.style.background = "var(--button-primary)";
            badge.style.color = "var(--button-primary-text)";
          } else if (tab.pinned) {
            badge.textContent = "PINNED";
            badge.style.background = "var(--button-hover)";
            badge.style.color = "var(--text-popup)";
          } else {
            badge.textContent = "CLOSE";
            badge.style.background = "rgba(244, 67, 54, 0.25)";
            badge.style.color = "var(--text-popup)";
          }

          const title = document.createElement("div");
          title.style.cssText = "white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;";
          title.textContent = tab.title || tab.url || "Untitled";
          title.title = tab.url || "";

          const wsp = document.createElement("div");
          wsp.style.cssText = "opacity: 0.7; white-space: nowrap;";
          wsp.textContent = tab.wspName ? `in “${tab.wspName}”` : "";

          row.appendChild(badge);
          row.appendChild(title);
          row.appendChild(wsp);
          items.appendChild(row);
        }

        box.appendChild(items);
        listContainer.appendChild(box);
      }
    };

    // Insert content after message
    msgEl.parentNode.insertBefore(container, inputEl);

    okBtn.hidden = false;
    okBtn.textContent = "Close duplicates";
    cancelBtn.textContent = "Cancel";
    backdrop.classList.add("show");

    const cleanup = () => {
      backdrop.classList.remove("show");
      container.remove();
      okBtn.textContent = "OK";
      cancelBtn.textContent = "Cancel";
      okBtn.removeEventListener("click", onCloseDuplicates);
      cancelBtn.removeEventListener("click", onCancel);
      ignoreHashInput.removeEventListener("change", render);
      ignoreQueryInput.removeEventListener("change", render);
      scopeSelect.removeEventListener("change", render);
    };

    const onCancel = () => {
      cleanup();
    };

    const onCloseDuplicates = async () => {
      const { groups, closeCount } = compute();
      if (closeCount === 0) {
        cleanup();
        return;
      }

      okBtn.disabled = true;
      okBtn.textContent = "Closing…";

      const ids = groups.flatMap(g => g.closeIds);

      try {
        await browser.tabs.remove(ids);
      } catch (e) {
        // Fallback: remove individually
        for (const tabId of ids) {
          try {
            await browser.tabs.remove(tabId);
          } catch (err) {
            // ignore
          }
        }
      }

      cleanup();
      window.location.reload();
    };

    ignoreHashInput.addEventListener("change", render);
    ignoreQueryInput.addEventListener("change", render);
    scopeSelect.addEventListener("change", render);
    okBtn.addEventListener("click", onCloseDuplicates);
    cancelBtn.addEventListener("click", onCancel);

    render();
  }

  _getImportValidationError(data) {
    if (!data || typeof data !== "object") {
      return "Root JSON must be an object.";
    }
    if (!Number.isInteger(data.version)) {
      return "Missing or invalid 'version' field.";
    }
    if (!Array.isArray(data.workspaces)) {
      return "Missing or invalid 'workspaces' array.";
    }
    for (let i = 0; i < data.workspaces.length; i++) {
      const wsp = data.workspaces[i];
      if (!wsp || typeof wsp !== "object") {
        return `workspaces[${i}] must be an object.`;
      }
      if (typeof wsp.name !== "string" || wsp.name.trim().length === 0) {
        return `workspaces[${i}].name must be a non-empty string.`;
      }
      if (!Array.isArray(wsp.tabs)) {
        return `workspaces[${i}].tabs must be an array.`;
      }
    }
    return null;
  }

  async _importWorkspaces(file) {
    try {
      const text = await file.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch (e) {
        await showCustomDialog({ message: "Invalid file format. Please select a valid workspaces export file." });
        return;
      }

      // Validate structure
      const validationError = this._getImportValidationError(data);
      if (validationError) {
        await showCustomDialog({ message: `Invalid file format. ${validationError}` });
        return;
      }

      if (data.workspaces.length === 0) {
        await showCustomDialog({ message: "No workspaces found in the export file." });
        return;
      }

      // Ask for confirmation
      const confirmed = await showCustomDialog({
        message: `Import ${data.workspaces.length} workspace(s)? This will add to your existing workspaces.`
      });

      if (!confirmed) {
        return;
      }

      const windowId = (await browser.windows.getCurrent()).id;
      let importedCount = 0;
      let failedTabs = 0;

      const totalTabsToCreate = data.workspaces.reduce((sum, wsp) => sum + ((wsp.tabs || []).length), 0);
      const suppressMs = Math.min(10 * 60 * 1000, Math.max(20000, totalTabsToCreate * 250));
      await this._callBackgroundTask("suppressTabTracking", { ms: suppressMs });

      // Get existing workspace names to avoid duplicates
      const existingNames = this.workspaces.map(w => w.name.toLowerCase());

      try {
        for (const wspData of data.workspaces) {
          // Handle duplicate names
          let wspName = wspData.name || "Imported Workspace";
          if (existingNames.includes(wspName.toLowerCase())) {
            wspName = `${wspName} (imported)`;
          }
          existingNames.push(wspName.toLowerCase());

          // Create tabs for this workspace (preserve indices for group mapping)
          const tabIdsByIndex = [];
           for (const tabData of (wspData.tabs || [])) {
             const url = tabData?.url;
             if (!url) {
               tabIdsByIndex.push(null);
               failedTabs++;
               continue;
             }

            try {
              const newTab = await browser.tabs.create({
                url,
                active: false,
                windowId
              });
              tabIdsByIndex.push(newTab.id);
            } catch (e) {
              tabIdsByIndex.push(null);
              failedTabs++;
            }
          }

          const tabIds = tabIdsByIndex.filter(Boolean);

          // Hide the imported tabs immediately
          if (tabIds.length > 0) {
            try {
              await browser.tabs.hide(tabIds);
            } catch (e) {
              // May fail if tabs aren't ready yet
            }
          }

          // Re-map groups (stored as tabIndices) to created tab IDs
          const groups = [];
          for (const group of (wspData.groups || [])) {
            const indices = Array.isArray(group.tabIndices) ? group.tabIndices : (Array.isArray(group.tabs) ? group.tabs : []);
            const groupTabIds = indices
              .filter(i => Number.isInteger(i) && i >= 0 && i < tabIdsByIndex.length)
              .map(i => tabIdsByIndex[i])
              .filter(Boolean);

            if (groupTabIds.length === 0) continue;

            groups.push({
              title: group.title || group.name || "",
              color: group.color,
              collapsed: !!group.collapsed,
              tabs: groupTabIds
            });
          }

          const tags = Array.isArray(wspData.tags)
            ? wspData.tags
            : (typeof wspData.tags === "string" ? wspData.tags.split(",").map(t => t.trim()).filter(Boolean) : []);

          // Create the workspace
          const wsp = {
            id: Date.now() + importedCount, // Unique ID
            name: wspName,
            color: wspData.color || "",
            pinned: wspData.pinned || false,
            tags,
            active: false,
            tabs: tabIds,
            groups,
            windowId: windowId
          };

          await this._callBackgroundTask("createWorkspace", wsp);
          this.workspaces.push(wsp);
          this._addWorkspace(wsp);
          importedCount++;
        }

        // Ensure inactive workspaces (including imported) are hidden
        await this._callBackgroundTask("hideInactiveWspTabs", { windowId });
      } finally {
        await this._callBackgroundTask("suppressTabTracking", { ms: 0 });
      }

      // Reload tabs for search
      await this._loadAllTabs();

      let message = `Successfully imported ${importedCount} workspace(s).`;
      if (failedTabs > 0) {
        message += ` ${failedTabs} tab(s) could not be loaded.`;
      }
      await showCustomDialog({ message });

    } catch (e) {
      console.error("Import error:", e);
      await showCustomDialog({ message: "Failed to import workspaces. Please try again." });
    }
  }

  _createPreviewTooltip() {
    // Create tooltip element if it doesn't exist
    let tooltip = document.getElementById("tab-preview-tooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.id = "tab-preview-tooltip";
      tooltip.className = "tab-preview-tooltip";
      document.body.appendChild(tooltip);
    }
    return tooltip;
  }

  _showTabPreview(tab, event) {
    const tooltip = this._createPreviewTooltip();

    // Build tooltip content
    tooltip.replaceChildren();

    const header = document.createElement("div");
    header.className = "tab-preview-header";

    const favicon = document.createElement("img");
    const fallbackIcon = "../icons/dark64.png";
    favicon.src = tab.favIconUrl || fallbackIcon;
    favicon.className = "tab-preview-favicon";
    favicon.addEventListener("error", () => {
      if (favicon.src !== fallbackIcon) {
        favicon.src = fallbackIcon;
      }
    });
    header.appendChild(favicon);

    const title = document.createElement("div");
    title.className = "tab-preview-title";
    title.textContent = tab.title;
    header.appendChild(title);

    tooltip.appendChild(header);

    const url = document.createElement("div");
    url.className = "tab-preview-url";
    url.textContent = tab.url;
    tooltip.appendChild(url);

    const workspace = document.createElement("div");
    workspace.className = "tab-preview-workspace";

    if (tab.wspColor) {
      const colorDot = document.createElement("div");
      colorDot.className = "tab-preview-color";
      colorDot.style.background = tab.wspColor;
      workspace.appendChild(colorDot);
    }

    const workspaceName = document.createElement("span");
    workspaceName.className = "tab-preview-workspace-name";
    workspaceName.textContent = `in "${tab.wspName}"`;
    workspace.appendChild(workspaceName);

    tooltip.appendChild(workspace);

    // Position tooltip
    const rect = event.target.closest("li").getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    let left = rect.right + 10;
    let top = rect.top;

    // Adjust if tooltip would go off screen
    if (left + 300 > window.innerWidth) {
      left = rect.left - 310;
    }
    if (top + 150 > window.innerHeight) {
      top = window.innerHeight - 160;
    }
    if (top < 10) {
      top = 10;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;

    // Show tooltip with delay
    clearTimeout(this._previewTimeout);
    this._previewTimeout = setTimeout(() => {
      tooltip.classList.add("visible");
    }, 400);
  }

  _hideTabPreview() {
    clearTimeout(this._previewTimeout);
    const tooltip = document.getElementById("tab-preview-tooltip");
    if (tooltip) {
      tooltip.classList.remove("visible");
    }
  }

  _getWorkspaceNameLower(wsp) {
    const name = (wsp?.name || "").toString();
    if (wsp._wspSearchName !== name) {
      wsp._wspSearchName = name;
      wsp._wspSearchNameLower = name.toLowerCase();
    }
    return wsp._wspSearchNameLower || "";
  }

  _getWorkspaceTagsLower(wsp) {
    const tags = Array.isArray(wsp?.tags) ? wsp.tags.map(t => (t || "").toString().trim()).filter(Boolean).join(",") : "";
    if (wsp._wspSearchTags !== tags) {
      wsp._wspSearchTags = tags;
      wsp._wspSearchTagsLower = tags.toLowerCase();
    }
    return wsp._wspSearchTagsLower || "";
  }

  _parseSearchQuery(rawQuery) {
    const raw = (rawQuery || "").toString().trim();
    const parts = raw.length === 0 ? [] : raw.split(/\s+/).filter(Boolean);

    const parsed = {
      raw,
      freeTerms: [],
      workspaceTerms: [],
      tagTerms: [],
      titleTerms: [],
      urlTerms: [],
      isPinned: null,
      isMuted: null,
    };

    for (const token of parts) {
      const match = /^([^:]+):(.+)$/.exec(token);
      if (!match) {
        parsed.freeTerms.push(token.toLowerCase());
        continue;
      }

      const key = match[1].toLowerCase();
      const value = match[2];
      const valueLower = value.toLowerCase();

      if (key === "w" || key === "workspace") {
        parsed.workspaceTerms.push(valueLower);
        continue;
      }
      if (key === "title") {
        parsed.titleTerms.push(valueLower);
        continue;
      }
      if (key === "tag" || key === "tags") {
        parsed.tagTerms.push(valueLower);
        continue;
      }
      if (key === "url") {
        parsed.urlTerms.push(valueLower);
        continue;
      }
      if (key === "is") {
        if (valueLower === "pinned") {
          parsed.isPinned = true;
          continue;
        }
        if (valueLower === "unpinned") {
          parsed.isPinned = false;
          continue;
        }
        if (valueLower === "muted") {
          parsed.isMuted = true;
          continue;
        }
        if (valueLower === "unmuted") {
          parsed.isMuted = false;
          continue;
        }
      }

      // Unknown operator: degrade gracefully to plain search.
      parsed.freeTerms.push(token.toLowerCase());
    }

    return parsed;
  }

  _getTermsScore(textLower, termsLower) {
    const terms = Array.isArray(termsLower) ? termsLower : [];
    let score = 0;

    for (const term of terms) {
      const q = (term || "").toString().trim();
      if (q.length === 0) continue;
      const s = this._getMatchScoreLower(textLower || "", q);
      if (s === null) return null;
      score += s;
    }

    return score;
  }

  _getWorkspaceSearchScore(workspace, parsed) {
    if (workspace?.archived) return null;
    if (workspace?.snoozedUntil != null) return null;

    const nameLower = this._getWorkspaceNameLower(workspace);
    const tagsLower = this._getWorkspaceTagsLower(workspace);

    const tagScore = this._getTermsScore(tagsLower, parsed?.tagTerms);
    if (tagScore === null) {
      return null;
    }

    const terms = [
      ...(parsed?.workspaceTerms || []),
      ...(parsed?.freeTerms || []),
    ];

    if (terms.length === 0) {
      // Tag-only queries should still return workspace results.
      const hasTagTerms = Array.isArray(parsed?.tagTerms) && parsed.tagTerms.length > 0;
      return hasTagTerms ? tagScore : null;
    }

    const nameScore = this._getTermsScore(nameLower, terms);
    if (nameScore === null) return null;

    return tagScore + nameScore;
  }

  _getTabSearchScore(tab, parsed) {
    const pinned = !!tab?.pinned;
    const muted = !!tab?.muted;

    if (parsed?.isPinned !== null && pinned !== parsed.isPinned) {
      return null;
    }
    if (parsed?.isMuted !== null && muted !== parsed.isMuted) {
      return null;
    }

    // Optional workspace filter (matches "Pinned" / "Unassigned" labels too).
    const wspNameLower = (tab?.wspNameLower || "").toString();
    if (this._getTermsScore(wspNameLower, parsed?.workspaceTerms) === null) {
      return null;
    }

    // Optional workspace tag filter.
    const wspTagsLower = (tab?.wspTagsLower || "").toString();
    if (this._getTermsScore(wspTagsLower, parsed?.tagTerms) === null) {
      return null;
    }

    // Explicit field filters.
    const titleLower = (tab?.titleLower || "").toString();
    const urlLower = (tab?.urlLower || "").toString();

    const titleTermsScore = this._getTermsScore(titleLower, parsed?.titleTerms);
    if (titleTermsScore === null) return null;

    const urlTermsScore = this._getTermsScore(urlLower, parsed?.urlTerms);
    if (urlTermsScore === null) return null;

    // Free terms match either title or URL.
    let freeScore = 0;
    const freeTerms = Array.isArray(parsed?.freeTerms) ? parsed.freeTerms : [];
    for (const term of freeTerms) {
      const q = (term || "").toString().trim();
      if (q.length === 0) continue;

      const titleScore = this._getMatchScoreLower(titleLower, q);
      const urlScore = this._getMatchScoreLower(urlLower, q);

      let best = null;
      if (titleScore !== null) {
        best = titleScore;
      }
      if (urlScore !== null) {
        best = best === null ? (urlScore + 0.5) : Math.min(best, urlScore + 0.5);
      }

      if (best === null) {
        return null;
      }

      freeScore += best;
    }

    // Prefer title filters over URL filters slightly.
    const urlPenalty = (Array.isArray(parsed?.urlTerms) ? parsed.urlTerms.length : 0) * 0.5;
    return freeScore + titleTermsScore + urlTermsScore + urlPenalty;
  }

  _getCommandSearchScore(cmd, queryLower) {
    const q = (queryLower || "").toString().trim().toLowerCase();
    if (q.length === 0) return 0;

    const terms = q.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return 0;

    const nameLower = (cmd?.name || "").toString().toLowerCase();
    const scoreName = this._getTermsScore(nameLower, terms);
    if (scoreName !== null) return scoreName;

    const keywordsLower = Array.isArray(cmd?.keywords) ? cmd.keywords.map(x => (x || "").toString()).join(" ").toLowerCase() : "";
    const descriptionLower = (cmd?.description || "").toString().toLowerCase();
    const combinedLower = `${nameLower} ${keywordsLower} ${descriptionLower}`.trim();

    const scoreCombined = this._getTermsScore(combinedLower, terms);
    if (scoreCombined === null) return null;

    // Penalize matches that require keywords/description vs. name-only.
    return scoreCombined + 1;
  }

  _getActiveWorkspace() {
    return this.workspaces.find(w => w && w.active) || null;
  }

  _formatDatetimeLocalValue(ts) {
    const value = Number(ts);
    if (!Number.isFinite(value)) return "";
    const d = new Date(value);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  _parseDatetimeLocalValue(value) {
    const raw = (value || "").toString().trim();
    if (!raw) return null;
    const ts = new Date(raw).getTime();
    return Number.isFinite(ts) ? ts : null;
  }

  async _showSnoozeDialog({ title, subtitle, defaultWakeAt, defaultActivateOnWake = true, showActivateOnWake = true } = {}) {
    return await new Promise((resolve) => {
      const backdrop = document.getElementById("custom-dialog-backdrop");
      const msgEl = document.getElementById("custom-dialog-message");
      const inputEl = document.getElementById("custom-dialog-input");
      const colorPicker = document.getElementById("custom-dialog-colors");
      const okBtn = document.getElementById("custom-dialog-ok");
      const cancelBtn = document.getElementById("custom-dialog-cancel");

      msgEl.replaceChildren();

      const titleEl = document.createElement("strong");
      titleEl.textContent = (title || "Snooze").toString();
      msgEl.appendChild(titleEl);

      if (subtitle) {
        msgEl.appendChild(document.createElement("br"));
        const subtitleEl = document.createElement("small");
        subtitleEl.textContent = subtitle.toString();
        msgEl.appendChild(subtitleEl);
      }

      inputEl.hidden = true;
      colorPicker.hidden = true;

      const container = document.createElement("div");
      container.className = "settings-dialog";
      container.style.cssText = "margin: 12px 0;";

      const errorEl = document.createElement("div");
      errorEl.style.cssText = "display: none; padding: 8px; margin-bottom: 8px; background: rgba(244, 67, 54, 0.15); border: 1px solid rgba(244, 67, 54, 0.35); border-radius: 6px; font-size: 0.85em;";
      container.appendChild(errorEl);

      const row = document.createElement("div");
      row.className = "settings-row";

      const label = document.createElement("label");
      label.textContent = "Wake at:";
      label.htmlFor = "snooze-wakeat-input";
      row.appendChild(label);

      const wakeAtInput = document.createElement("input");
      wakeAtInput.type = "datetime-local";
      wakeAtInput.id = "snooze-wakeat-input";
      wakeAtInput.value = this._formatDatetimeLocalValue(defaultWakeAt);
      row.appendChild(wakeAtInput);

      container.appendChild(row);

      let activateOnWakeInput = null;
      if (showActivateOnWake) {
        const activateRow = document.createElement("div");
        activateRow.className = "settings-row";
        activateRow.style.marginTop = "6px";

        const activateLabel = document.createElement("label");
        activateLabel.textContent = "Activate on wake:";
        activateLabel.htmlFor = "snooze-activate-on-wake-input";
        activateRow.appendChild(activateLabel);

        activateOnWakeInput = document.createElement("input");
        activateOnWakeInput.type = "checkbox";
        activateOnWakeInput.id = "snooze-activate-on-wake-input";
        activateOnWakeInput.checked = !!defaultActivateOnWake;
        activateRow.appendChild(activateOnWakeInput);

        container.appendChild(activateRow);
      }

      const hint = document.createElement("div");
      hint.className = "settings-hint";
      hint.textContent = "Time is in your local timezone.";
      container.appendChild(hint);

      msgEl.appendChild(container);

      const prevOkText = okBtn.textContent;
      const prevCancelText = cancelBtn.textContent;
      okBtn.textContent = "Snooze";
      cancelBtn.textContent = "Cancel";

      const setError = (msg) => {
        const text = (msg || "").toString();
        if (!text) {
          errorEl.style.display = "none";
          errorEl.textContent = "";
        } else {
          errorEl.style.display = "";
          errorEl.textContent = text;
        }
      };

      const updateOkState = () => {
        const wakeAt = this._parseDatetimeLocalValue(wakeAtInput.value);
        if (!wakeAt) {
          okBtn.disabled = true;
          setError("Please choose a valid date/time.");
          return;
        }
        if (wakeAt <= Date.now()) {
          okBtn.disabled = true;
          setError("Wake time must be in the future.");
          return;
        }
        okBtn.disabled = false;
        setError("");
      };

      const cleanup = (result) => {
        backdrop.classList.remove("show");
        container.remove();
        okBtn.textContent = prevOkText;
        cancelBtn.textContent = prevCancelText;
        okBtn.disabled = false;
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        wakeAtInput.removeEventListener("input", updateOkState);
        resolve(result);
      };

      const onCancel = () => cleanup(false);

      const onOk = () => {
        const wakeAt = this._parseDatetimeLocalValue(wakeAtInput.value);
        if (!wakeAt || wakeAt <= Date.now()) {
          updateOkState();
          return;
        }
        cleanup({
          wakeAt,
          activateOnWake: activateOnWakeInput ? !!activateOnWakeInput.checked : !!defaultActivateOnWake
        });
      };

      wakeAtInput.addEventListener("input", updateOkState);
      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);

      updateOkState();
      backdrop.classList.add("show");
    });
  }

  async _snoozeActiveWorkspaceFlow() {
    const active = this._getActiveWorkspace();
    if (!active) {
      await showCustomDialog({ message: "No active workspace found." });
      return;
    }

    const defaultWakeAt = Date.now() + 60 * 60 * 1000;
    const picked = await this._showSnoozeDialog({
      title: "Snooze workspace",
      subtitle: `“${active.name || "Unnamed"}” will be restored later.`,
      defaultWakeAt,
      defaultActivateOnWake: true,
      showActivateOnWake: true
    });
    if (picked === false) return;

    const result = await this._callBackgroundTask("snoozeWorkspace", {
      wspId: active.id,
      wakeAt: picked.wakeAt,
      activateOnWake: picked.activateOnWake
    });
    const err = this._getBackgroundError(result);
    if (err) {
      await showCustomDialog({ message: `Failed to snooze workspace: ${err}` });
      return;
    }

    window.location.reload();
  }

  async _snoozeSelectedTabsFlow() {
    const windowId = this.currentWindowId || (await browser.windows.getCurrent()).id;
    const selectedTabs = await browser.tabs.query({ windowId, highlighted: true });
    const tabIds = Array.isArray(selectedTabs) ? selectedTabs.map(t => t.id) : [];

    if (tabIds.length === 0) {
      await showCustomDialog({ message: "No selected tabs." });
      return;
    }

    const defaultWakeAt = Date.now() + 60 * 60 * 1000;
    const picked = await this._showSnoozeDialog({
      title: "Snooze selected tabs",
      subtitle: `Restore ${tabIds.length} selected tab(s) later.`,
      defaultWakeAt,
      defaultActivateOnWake: false,
      showActivateOnWake: true
    });
    if (picked === false) return;

    const result = await this._callBackgroundTask("snoozeTabs", {
      windowId,
      tabIds,
      wakeAt: picked.wakeAt,
      activateOnWake: picked.activateOnWake
    });
    const err = this._getBackgroundError(result);
    if (err) {
      await showCustomDialog({ message: `Failed to snooze tabs: ${err}` });
      return;
    }

    window.location.reload();
  }

  async _showSnoozesDialog() {
    const backdrop = document.getElementById("custom-dialog-backdrop");
    const msgEl = document.getElementById("custom-dialog-message");
    const inputEl = document.getElementById("custom-dialog-input");
    const colorPicker = document.getElementById("custom-dialog-colors");
    const okBtn = document.getElementById("custom-dialog-ok");
    const cancelBtn = document.getElementById("custom-dialog-cancel");

    msgEl.replaceChildren();
    const titleEl = document.createElement("strong");
    titleEl.textContent = "Snoozed items";
    msgEl.appendChild(titleEl);
    msgEl.appendChild(document.createElement("br"));
    const subtitle = document.createElement("small");
    subtitle.textContent = "Wake snoozed workspaces/tabs now or cancel the schedule.";
    msgEl.appendChild(subtitle);

    inputEl.hidden = true;
    colorPicker.hidden = true;

    const listContainer = document.createElement("div");
    listContainer.style.cssText = "max-height: 260px; overflow-y: auto; margin: 12px 0; display: flex; flex-direction: column; gap: 6px;";

    const formatWhen = (ts) => {
      const value = Number(ts);
      if (!Number.isFinite(value)) return "unknown";
      try {
        return new Date(value).toLocaleString();
      } catch (_) {
        return "unknown";
      }
    };

    const load = async () => {
      const snoozes = await this._callBackgroundTask("getSnoozes").catch(() => []);
      const list = Array.isArray(snoozes) ? snoozes : [];

      listContainer.replaceChildren();
      if (list.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = "padding: 12px; text-align: center; opacity: 0.7;";
        empty.textContent = "No snoozed items.";
        listContainer.appendChild(empty);
        return;
      }

      for (const snooze of list) {
        const row = document.createElement("div");
        row.style.cssText = "display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 6px; background: var(--button-bg); border: 1px solid var(--border-popup);";

        const info = document.createElement("div");
        info.style.cssText = "flex: 1; overflow: hidden;";

        const nameEl = document.createElement("div");
        nameEl.style.cssText = "font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";

        const type = (snooze?.type || "workspace").toString();
        if (type === "workspace") {
          const wspName = (snooze?.payload?.workspace?.name || "Workspace").toString();
          nameEl.textContent = `Workspace: ${wspName}`;
        } else {
          const count = Array.isArray(snooze?.payload?.tabs) ? snooze.payload.tabs.length : 0;
          nameEl.textContent = `Tabs: ${count} tab(s)`;
        }
        info.appendChild(nameEl);

        const metaEl = document.createElement("div");
        metaEl.style.cssText = "font-size: 0.8em; opacity: 0.75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
        metaEl.textContent = `Wake at: ${formatWhen(snooze?.wakeAt)}`;
        info.appendChild(metaEl);

        row.appendChild(info);

        const wakeBtn = document.createElement("button");
        wakeBtn.type = "button";
        wakeBtn.textContent = "Wake now";
        wakeBtn.addEventListener("click", async () => {
          const id = (snooze?.id || "").toString();
          if (!id) return;
          const res = await this._callBackgroundTask("wakeSnoozeNow", { snoozeId: id });
          const err = this._getBackgroundError(res);
          if (err) {
            await showCustomDialog({ message: `Wake failed: ${err}` });
            return;
          }
          await load();
          await this._loadAllTabs();
        });
        row.appendChild(wakeBtn);

        const cancelItemBtn = document.createElement("button");
        cancelItemBtn.type = "button";
        cancelItemBtn.textContent = "Cancel";
        cancelItemBtn.style.opacity = "0.85";
        cancelItemBtn.addEventListener("click", async () => {
          const id = (snooze?.id || "").toString();
          if (!id) return;
          const confirmed = await showCustomDialog({ message: "Cancel this snooze? This does not restore tabs." });
          if (!confirmed) return;

          const res = await this._callBackgroundTask("cancelSnooze", { snoozeId: id });
          const err = this._getBackgroundError(res);
          if (err) {
            await showCustomDialog({ message: `Cancel failed: ${err}` });
            return;
          }
          await load();
        });
        row.appendChild(cancelItemBtn);

        listContainer.appendChild(row);
      }
    };

    await load();
    msgEl.appendChild(listContainer);

    const cleanup = () => {
      backdrop.classList.remove("show");
      listContainer.remove();
      okBtn.textContent = "OK";
      cancelBtn.textContent = "Cancel";
      okBtn.removeEventListener("click", onClose);
      cancelBtn.removeEventListener("click", onClose);
    };

    const onClose = () => cleanup();
    okBtn.textContent = "Close";
    cancelBtn.textContent = "Close";
    okBtn.addEventListener("click", onClose);
    cancelBtn.addEventListener("click", onClose);

    backdrop.classList.add("show");
  }

  async _reloadWorkspaceTabs(workspace) {
    const tabs = Array.isArray(workspace?.tabs) ? workspace.tabs : [];
    if (tabs.length === 0) {
      await showCustomDialog({ message: `Workspace "${workspace?.name || "Unnamed"}" is empty.` });
      return;
    }

    let reloaded = 0;
    for (const tabId of tabs) {
      try {
        await browser.tabs.reload(tabId);
        reloaded++;
      } catch (e) {
        // Tab may not exist / not ready
      }
    }
    await showCustomDialog({ message: `Reloaded ${reloaded} tab(s) in "${workspace?.name || "Unnamed"}".` });
  }

  async _setWorkspaceMuted(workspace, muted) {
    const tabs = Array.isArray(workspace?.tabs) ? workspace.tabs : [];
    if (tabs.length === 0) {
      await showCustomDialog({ message: `Workspace "${workspace?.name || "Unnamed"}" is empty.` });
      return;
    }

    let updated = 0;
    for (const tabId of tabs) {
      try {
        await browser.tabs.update(tabId, { muted: !!muted });
        updated++;
      } catch (e) {
        // Tab may not exist / not ready
      }
    }

    await showCustomDialog({
      message: `${muted ? "Muted" : "Unmuted"} ${updated} tab(s) in "${workspace?.name || "Unnamed"}".`
    });
  }

  _getDuplicateUrlKey(url, { ignoreHash = true, ignoreQuery = false } = {}) {
    const raw = (url || "").toString();
    if (!raw) return null;
    if (raw.startsWith("about:") || raw.startsWith("chrome:") || raw.startsWith("moz-extension:")) return null;

    try {
      const u = new URL(raw);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      if (ignoreHash) u.hash = "";
      if (ignoreQuery) u.search = "";
      return `${u.origin}${u.pathname}${u.search}`;
    } catch (e) {
      return null;
    }
  }

  _getHostnameLowerFromUrl(url) {
    const raw = (url || "").toString();
    if (!raw) return "";
    if (raw.startsWith("about:") || raw.startsWith("chrome:") || raw.startsWith("moz-extension:")) return "";

    try {
      return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    } catch (_) {
      return "";
    }
  }

  _normalizeDomainInput(value) {
    const raw = (value || "").toString().trim();
    if (raw.length === 0) return null;

    try {
      if (raw.includes("://")) {
        return new URL(raw).hostname.replace(/^www\./, "");
      }
      return new URL(`https://${raw}`).hostname.replace(/^www\./, "");
    } catch (e) {
      return null;
    }
  }

  _urlMatchesDomain(url, domain) {
    const d = (domain || "").toString().trim().toLowerCase();
    if (d.length === 0) return false;

    try {
      const u = new URL((url || "").toString());
      const host = (u.hostname || "").toLowerCase().replace(/^www\./, "");
      return host === d || host.endsWith(`.${d}`);
    } catch (e) {
      return false;
    }
  }

  async _collectTabsByDomainFlow() {
    const windowId = this.currentWindowId || (await browser.windows.getCurrent()).id;

    let defaultDomain = "";
    try {
      const [activeTab] = await browser.tabs.query({ windowId, active: true });
      defaultDomain = this._normalizeDomainInput(activeTab?.url) || "";
    } catch (_) {}

    const domainInput = await showCustomDialog({
      message: "Collect tabs by domain:",
      withInput: true,
      defaultValue: defaultDomain
    });
    if (domainInput === false) return;

    const domain = this._normalizeDomainInput(domainInput);
    if (!domain) {
      await showCustomDialog({ message: "Invalid domain." });
      return;
    }

    const tabs = await browser.tabs.query({ windowId });
    const matchingCount = tabs.filter(t => !t.pinned && this._urlMatchesDomain(t.url, domain)).length;
    if (matchingCount === 0) {
      await showCustomDialog({ message: `No matching tabs for "${domain}".` });
      return;
    }

    const target = await showCustomDialog({
      message: `Move ${matchingCount} tab(s) from "${domain}" to workspace (existing name or new):`,
      withInput: true,
      defaultValue: domain,
      withColorPicker: true,
      defaultColor: "#2196f3"
    });
    if (target === false) return;

    const targetNameInput = (target?.name || "").toString().trim();
    if (targetNameInput.length === 0) return;

    const existing = this.workspaces.find(w => (w?.name || "").toString().trim().toLowerCase() === targetNameInput.toLowerCase());

    let toWspId = null;
    let resolvedName = targetNameInput;

    if (existing) {
      toWspId = existing.id;
      resolvedName = (existing?.name || targetNameInput).toString();
    } else {
      const wspId = Date.now();
      const createResult = await this._callBackgroundTask("createWorkspace", {
        id: wspId,
        name: targetNameInput,
        color: (target?.color || "").toString(),
        pinned: false,
        suspended: false,
        active: false,
        tabs: [],
        groups: [],
        windowId
      });

      const createErr = this._getBackgroundError(createResult);
      if (createErr) {
        await showCustomDialog({ message: `Failed to create workspace: ${createErr}` });
        return;
      }

      toWspId = wspId;
    }

    const result = await this._callBackgroundTask("collectTabsByDomain", {
      windowId,
      domain,
      toWspId,
      includeSubdomains: true
    });

    const err = this._getBackgroundError(result);
    if (err) {
      await showCustomDialog({ message: `Collect failed: ${err}` });
      return;
    }

    const movedCount = Number(result?.movedCount);
    await showCustomDialog({ message: `Moved ${Number.isFinite(movedCount) ? movedCount : 0} tab(s) from "${domain}" to "${resolvedName}".` });
    window.location.reload();
  }

  _getCommandPaletteCommands() {
    return [
      {
        id: "cmd-new-workspace",
        name: "New workspace",
        description: "Create a new workspace",
        keywords: ["create", "new", "workspace"],
        run: async () => {
          await this._promptCreateWorkspace();
        }
      },
      {
        id: "cmd-open-settings",
        name: "Open settings",
        description: "Open the settings dialog",
        keywords: ["settings", "options", "preferences"],
        run: async () => {
          await this._showSettingsDialog();
        }
      },
      {
        id: "cmd-archived-workspaces",
        name: "Archived workspaces",
        description: "View and restore archived workspaces",
        keywords: ["archived", "archive", "restore", "recover"],
        run: async () => {
          await this._showArchivedWorkspacesDialog();
        }
      },
      {
        id: "cmd-workspace-rules",
        name: "Workspace rules",
        description: "Auto-assign new tabs to workspaces",
        keywords: ["rules", "rule", "auto", "assign", "automation"],
        run: async () => {
          await this._showWorkspaceRulesDialog();
        }
      },
      {
        id: "cmd-snooze-workspace",
        name: "Snooze active workspace",
        description: "Close the active workspace and restore it later",
        keywords: ["snooze", "sleep", "later", "workspace"],
        run: async () => {
          await this._snoozeActiveWorkspaceFlow();
        }
      },
      {
        id: "cmd-snooze-selected-tabs",
        name: "Snooze selected tabs",
        description: "Close selected tabs and restore them later",
        keywords: ["snooze", "sleep", "later", "tabs", "selected"],
        run: async () => {
          await this._snoozeSelectedTabsFlow();
        }
      },
      {
        id: "cmd-snoozed-items",
        name: "Snoozed items",
        description: "View, wake, or cancel snoozed items",
        keywords: ["snooze", "snoozed", "sleep", "later"],
        run: async () => {
          await this._showSnoozesDialog();
        }
      },
      {
        id: "cmd-reload-active",
        name: "Reload active workspace",
        description: "Reload all tabs in the active workspace",
        keywords: ["reload", "refresh"],
        run: async () => {
          const active = this._getActiveWorkspace();
          if (!active) {
            await showCustomDialog({ message: "No active workspace found." });
            return;
          }
          await this._reloadWorkspaceTabs(active);
        }
      },
      {
        id: "cmd-mute-active",
        name: "Mute active workspace",
        description: "Mute all tabs in the active workspace",
        keywords: ["mute", "sound", "audio"],
        run: async () => {
          const active = this._getActiveWorkspace();
          if (!active) {
            await showCustomDialog({ message: "No active workspace found." });
            return;
          }
          await this._setWorkspaceMuted(active, true);
        }
      },
      {
        id: "cmd-unmute-active",
        name: "Unmute active workspace",
        description: "Unmute all tabs in the active workspace",
        keywords: ["unmute", "sound", "audio"],
        run: async () => {
          const active = this._getActiveWorkspace();
          if (!active) {
            await showCustomDialog({ message: "No active workspace found." });
            return;
          }
          await this._setWorkspaceMuted(active, false);
        }
      },
      {
        id: "cmd-close-duplicates-active",
        name: "Close duplicates",
        description: "Preview and close duplicate tabs in the active workspace",
        keywords: ["close", "duplicates", "dedupe", "duplicate"],
        run: async () => {
          await this._showDuplicateCleanupDialog({ scope: "active-workspace" });
        }
      },
      {
        id: "cmd-close-duplicates-window",
        name: "Close duplicates (window)",
        description: "Preview and close duplicate tabs across the entire window",
        keywords: ["close", "duplicates", "dedupe", "duplicate", "window"],
        run: async () => {
          await this._showDuplicateCleanupDialog({ scope: "window" });
        }
      },
      {
        id: "cmd-move-selected-tabs",
        name: "Move selected tabs",
        description: "Move highlighted tabs (Shift/Ctrl-click in the tab strip) to another workspace",
        keywords: ["move", "selected", "tabs", "highlighted"],
        run: async () => {
          await this._showMoveTabPicker(this.currentWindowId);
        }
      },
      {
        id: "cmd-close-selected-tabs",
        name: "Close selected tabs",
        description: "Close highlighted tabs (with undo)",
        keywords: ["close", "selected", "tabs", "highlighted", "undo"],
        run: async () => {
          const windowId = this.currentWindowId || (await browser.windows.getCurrent()).id;
          const selectedTabs = await browser.tabs.query({ windowId, highlighted: true });
          if (!Array.isArray(selectedTabs) || selectedTabs.length === 0) {
            await showCustomDialog({ message: "No selected tabs." });
            return;
          }

          const confirmed = await showCustomDialog({ message: `Close ${selectedTabs.length} selected tab(s)?` });
          if (!confirmed) return;

          const result = await this._callBackgroundTask("closeTabsWithUndo", {
            windowId,
            tabIds: selectedTabs.map(t => t.id)
          });
          const err = this._getBackgroundError(result);
          if (err) {
            await showCustomDialog({ message: `Failed to close tabs: ${err}` });
            return;
          }

          await this._loadAllTabs();
          if (result?.undo?.available) {
            this._showUndoToast(result.undo);
          }
        }
      },
      {
        id: "cmd-mute-selected-tabs",
        name: "Mute selected tabs",
        description: "Mute highlighted tabs",
        keywords: ["mute", "selected", "tabs", "highlighted", "audio"],
        run: async () => {
          const windowId = this.currentWindowId || (await browser.windows.getCurrent()).id;
          const selectedTabs = await browser.tabs.query({ windowId, highlighted: true });
          if (!Array.isArray(selectedTabs) || selectedTabs.length === 0) {
            await showCustomDialog({ message: "No selected tabs." });
            return;
          }

          for (const tab of selectedTabs) {
            try {
              await browser.tabs.update(tab.id, { muted: true });
            } catch (_) {}
          }
        }
      },
      {
        id: "cmd-unmute-selected-tabs",
        name: "Unmute selected tabs",
        description: "Unmute highlighted tabs",
        keywords: ["unmute", "selected", "tabs", "highlighted", "audio"],
        run: async () => {
          const windowId = this.currentWindowId || (await browser.windows.getCurrent()).id;
          const selectedTabs = await browser.tabs.query({ windowId, highlighted: true });
          if (!Array.isArray(selectedTabs) || selectedTabs.length === 0) {
            await showCustomDialog({ message: "No selected tabs." });
            return;
          }

          for (const tab of selectedTabs) {
            try {
              await browser.tabs.update(tab.id, { muted: false });
            } catch (_) {}
          }
        }
      },
      {
        id: "cmd-discard-selected-tabs",
        name: "Discard selected tabs",
        description: "Discard highlighted tabs to free memory",
        keywords: ["discard", "sleep", "selected", "tabs", "highlighted"],
        run: async () => {
          const windowId = this.currentWindowId || (await browser.windows.getCurrent()).id;
          const selectedTabs = await browser.tabs.query({ windowId, highlighted: true });
          if (!Array.isArray(selectedTabs) || selectedTabs.length === 0) {
            await showCustomDialog({ message: "No selected tabs." });
            return;
          }

          for (const tab of selectedTabs) {
            try {
              await browser.tabs.discard(tab.id);
            } catch (_) {}
          }
        }
      },
      {
        id: "cmd-collect-by-domain",
        name: "Collect tabs by domain",
        description: "Move all tabs from a domain into a chosen/new workspace",
        keywords: ["collect", "domain", "organize", "group", "move"],
        run: async () => {
          await this._collectTabsByDomainFlow();
        }
      },
      {
        id: "cmd-export-workspaces",
        name: "Export workspaces",
        description: "Download a JSON export of your workspaces",
        keywords: ["export", "backup", "download"],
        run: async () => {
          await this._exportWorkspaces();
        }
      },
    ];
  }

  _fuzzyMatch(textLower, queryLower) {
    if (!queryLower) return true;
    if (!textLower) return false;
    let ti = 0;
    let qi = 0;
    while (ti < textLower.length && qi < queryLower.length) {
      if (textLower[ti] === queryLower[qi]) {
        qi++;
      }
      ti++;
    }
    return qi === queryLower.length;
  }

  _getMatchScoreLower(textLower, queryLower) {
    const q = (queryLower || "").trim();
    const tl = (textLower || "").toString();

    if (q.length === 0) return 0;
    if (tl.length === 0) return null;

    if (tl === q) return 0;
    if (tl.startsWith(q)) return 1;

    const idx = tl.indexOf(q);
    if (idx !== -1) {
      // Earlier matches are slightly better
      return 2 + (idx / 1000);
    }

    if (!this._fuzzyMatch(tl, q)) {
      return null;
    }

    // Prefer tighter fuzzy matches (smaller span)
    let first = -1;
    let last = -1;
    let ti = 0;
    let qi = 0;
    while (ti < tl.length && qi < q.length) {
      if (tl[ti] === q[qi]) {
        if (first === -1) first = ti;
        last = ti;
        qi++;
      }
      ti++;
    }

    const span = first === -1 ? tl.length : (last - first);
    return 3 + (span / 1000);
  }

  _getMatchScore(text, query) {
    const q = (query || "").trim().toLowerCase();
    const tl = (text || "").toString().toLowerCase();
    return this._getMatchScoreLower(tl, q);
  }

  _applyHighlightedText(el, text, query) {
    el.replaceChildren();
    const raw = (text || "").toString();
    const q = (query || "").trim();

    if (q.length === 0) {
      el.textContent = raw;
      return;
    }

    const rawLower = raw.toLowerCase();
    const qLower = q.toLowerCase();

    const idx = rawLower.indexOf(qLower);
    if (idx !== -1) {
      const before = raw.slice(0, idx);
      const match = raw.slice(idx, idx + q.length);
      const after = raw.slice(idx + q.length);

      if (before) {
        el.appendChild(document.createTextNode(before));
      }

      const mark = document.createElement("mark");
      mark.textContent = match;
      el.appendChild(mark);

      if (after) {
        el.appendChild(document.createTextNode(after));
      }
      return;
    }

    if (!this._fuzzyMatch(rawLower, qLower)) {
      el.textContent = raw;
      return;
    }

    let qi = 0;
    let buffer = "";
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (qi < qLower.length && rawLower[i] === qLower[qi]) {
        if (buffer) {
          el.appendChild(document.createTextNode(buffer));
          buffer = "";
        }
        const mark = document.createElement("mark");
        mark.textContent = ch;
        el.appendChild(mark);
        qi++;
      } else {
        buffer += ch;
      }
    }
    if (buffer) {
      el.appendChild(document.createTextNode(buffer));
    }
  }

  _createFolderElement(folder, folderWorkspaces = []) {
    const folderItem = document.createElement("li");
    folderItem.className = "folder-item" + (folder.collapsed ? " collapsed" : " expanded");
    folderItem.dataset.folderId = folder.id;
    folderItem.dataset.originalText = folder.name || "";

    // Folder header
    const header = document.createElement("div");
    header.className = "folder-header";
    header.tabIndex = 0;
    header.setAttribute("role", "button");

    // Toggle icon
    const toggle = document.createElement("span");
    toggle.className = "folder-toggle";
    header.appendChild(toggle);

    // Folder icon
    const icon = document.createElement("span");
    icon.className = "folder-icon";
    icon.textContent = "📁";
    header.appendChild(icon);

    // Folder name
    const name = document.createElement("span");
    name.className = "folder-name";
    name.textContent = folder.name;
    if (folder.color) {
      name.style.color = folder.color;
    }
    header.appendChild(name);

    // Workspace count
    const count = document.createElement("span");
    count.className = "folder-count";
    const folderWorkspacesList = Array.isArray(folderWorkspaces) ? folderWorkspaces : [];
    const wspCount = folderWorkspacesList.length;
    count.textContent = `(${wspCount})`;
    header.appendChild(count);

    // Actions
    const actions = document.createElement("div");
    actions.className = "folder-actions";

    const renameBtn = document.createElement("a");
    renameBtn.href = "#";
    renameBtn.className = "folder-rename-btn";
    renameBtn.title = "Rename folder";
    renameBtn.setAttribute("aria-label", "Rename folder");
    actions.appendChild(renameBtn);

    const deleteBtn = document.createElement("a");
    deleteBtn.href = "#";
    deleteBtn.className = "folder-delete-btn";
    deleteBtn.title = "Delete folder";
    deleteBtn.setAttribute("aria-label", "Delete folder");
    actions.appendChild(deleteBtn);

    const rulesBtn = document.createElement("a");
    rulesBtn.href = "#";
    rulesBtn.className = "folder-rules-btn";
    rulesBtn.title = "Folder rules";
    rulesBtn.setAttribute("aria-label", "Folder rules");
    actions.appendChild(rulesBtn);

    header.appendChild(actions);
    folderItem.appendChild(header);

    // Folder contents
    const contents = document.createElement("div");
    contents.className = "folder-contents";
    contents.id = `folder-contents-${String(folder.id)}`;
    header.setAttribute("aria-controls", contents.id);
    header.setAttribute("aria-expanded", folderItem.classList.contains("expanded") ? "true" : "false");

    // Add workspaces in this folder
    for (const workspace of folderWorkspacesList) {
      const li = this._createListItemAndRegisterListeners(workspace);
      li.dataset.folderId = folder.id;
      contents.appendChild(li);
    }

    folderItem.appendChild(contents);

    // Event listeners
    const setCollapsed = async (nextCollapsed, { persist = true } = {}) => {
      folderItem.classList.toggle("collapsed", nextCollapsed);
      folderItem.classList.toggle("expanded", !nextCollapsed);
      header.setAttribute("aria-expanded", nextCollapsed ? "false" : "true");

      if (!persist) return;
      await this._callBackgroundTask("updateFolder", {
        windowId: this.currentWindowId,
        folderId: folder.id,
        updates: { collapsed: nextCollapsed }
      });
    };

    const toggleCollapsed = async ({ persist = true } = {}) => {
      const isCollapsed = folderItem.classList.contains("collapsed");
      await setCollapsed(!isCollapsed, { persist });
    };

    toggle.addEventListener("click", async (e) => {
      e.stopPropagation();
      await toggleCollapsed({ persist: true });
    });

    header.addEventListener("click", async (e) => {
      if (e.target === header || e.target === name || e.target === icon || e.target === count) {
        await toggleCollapsed({ persist: true });
      }
    });

	    renameBtn.addEventListener("click", async (e) => {
	      e.preventDefault();
	      e.stopPropagation();
      const result = await showCustomDialog({
        message: "Rename folder:",
        withInput: true,
        defaultValue: folder.name
      });
      if (result && result !== false) {
        await this._callBackgroundTask("updateFolder", {
          windowId: this.currentWindowId,
          folderId: folder.id,
          updates: { name: result }
        });
        name.textContent = result;
        folderItem.dataset.originalText = result;
        this._sortWorkspaces();
      }
	    });

	    rulesBtn.addEventListener("click", async (e) => {
	      e.preventDefault();
	      e.stopPropagation();
	      await this._showFolderRulesDialog(folder);
	    });

	    deleteBtn.addEventListener("click", async (e) => {
	      e.preventDefault();
	      e.stopPropagation();
      const confirmed = await showCustomDialog({
        message: `Delete folder "${folder.name}"? Workspaces inside will be moved to root level.`
      });
      if (confirmed) {
        await this._callBackgroundTask("deleteFolder", {
          windowId: this.currentWindowId,
          folderId: folder.id
        });
        // Refresh the list
        this.folders = await this._callBackgroundTask("getFolders", { windowId: this.currentWindowId });
        document.getElementById("wsp-list").innerHTML = "";
        this.displayWorkspaces();
      }
    });

    // Drag-drop to move workspaces into folder
    header.addEventListener("dragover", (e) => {
      e.preventDefault();
      header.classList.add("drag-over-folder");
    });

    header.addEventListener("dragleave", (e) => {
      header.classList.remove("drag-over-folder");
    });

    header.addEventListener("drop", async (e) => {
      e.preventDefault();
      header.classList.remove("drag-over-folder");
      const wspId = e.dataTransfer.getData("text/plain");
      if (wspId) {
        await this._callBackgroundTask("addWorkspaceToFolder", {
          windowId: this.currentWindowId,
          wspId: wspId,
          folderId: folder.id
        });
        // Refresh the list
        this.folders = await this._callBackgroundTask("getFolders", { windowId: this.currentWindowId });
        document.getElementById("wsp-list").innerHTML = "";
        this.displayWorkspaces();
      }
    });

    return folderItem;
  }

  async _createFolder() {
    const result = await showCustomDialog({
      message: "Create folder:",
      withInput: true,
      defaultValue: "New Folder"
    });

    if (result && result !== false) {
      await this._callBackgroundTask("createFolder", {
        windowId: this.currentWindowId,
        folder: { name: result }
      });
      // Refresh the list
      this.folders = await this._callBackgroundTask("getFolders", { windowId: this.currentWindowId });
      document.getElementById("wsp-list").innerHTML = "";
      this.displayWorkspaces();
    }
  }

  async _showFolderRulesDialog(folder) {
    const backdrop = document.getElementById("custom-dialog-backdrop");
    const msgEl = document.getElementById("custom-dialog-message");
    const inputEl = document.getElementById("custom-dialog-input");
    const colorPicker = document.getElementById("custom-dialog-colors");
    const okBtn = document.getElementById("custom-dialog-ok");
    const cancelBtn = document.getElementById("custom-dialog-cancel");

    const smart = folder?.smart && typeof folder.smart === "object" ? folder.smart : {};
    const existingTags = Array.isArray(smart.tags) ? smart.tags : [];
    const existingDomains = Array.isArray(smart.domains) ? smart.domains : [];
    const existingPinned = typeof smart.pinned === "string" ? smart.pinned : "any";

    msgEl.replaceChildren();
    const titleEl = document.createElement("strong");
    titleEl.textContent = `Folder rules — ${folder?.name || "Folder"}`;
    msgEl.appendChild(titleEl);
    msgEl.appendChild(document.createElement("br"));
    const subtitleEl = document.createElement("small");
    subtitleEl.textContent = "Smart rules add matching workspaces (manual membership still applies).";
    msgEl.appendChild(subtitleEl);

    inputEl.hidden = true;
    colorPicker.hidden = true;

    const container = document.createElement("div");
    container.className = "settings-dialog";
    container.style.cssText = "margin: 12px 0;";

    const errorEl = document.createElement("div");
    errorEl.style.cssText = "display: none; padding: 8px; margin-bottom: 8px; background: rgba(244, 67, 54, 0.15); border: 1px solid rgba(244, 67, 54, 0.35); border-radius: 6px; font-size: 0.85em;";
    container.appendChild(errorEl);

    const enabledRow = document.createElement("div");
    enabledRow.className = "settings-row";
    const enabledLabel = document.createElement("label");
    enabledLabel.textContent = "Enable smart folder:";
    enabledLabel.htmlFor = "folder-smart-enabled-input";
    enabledRow.appendChild(enabledLabel);
    const enabledInput = document.createElement("input");
    enabledInput.type = "checkbox";
    enabledInput.id = "folder-smart-enabled-input";
    enabledInput.checked = smart.enabled === true;
    enabledRow.appendChild(enabledInput);
    container.appendChild(enabledRow);

    const tagsRow = document.createElement("div");
    tagsRow.className = "settings-row";
    tagsRow.style.marginTop = "6px";
    const tagsLabel = document.createElement("label");
    tagsLabel.textContent = "Tags (comma-separated):";
    tagsLabel.htmlFor = "folder-smart-tags-input";
    tagsRow.appendChild(tagsLabel);
    const tagsInput = document.createElement("input");
    tagsInput.type = "text";
    tagsInput.id = "folder-smart-tags-input";
    tagsInput.placeholder = "work, personal";
    tagsInput.value = existingTags.join(", ");
    tagsRow.appendChild(tagsInput);
    container.appendChild(tagsRow);

    const domainsRow = document.createElement("div");
    domainsRow.className = "settings-row";
    domainsRow.style.marginTop = "6px";
    const domainsLabel = document.createElement("label");
    domainsLabel.textContent = "Domains (comma-separated):";
    domainsLabel.htmlFor = "folder-smart-domains-input";
    domainsRow.appendChild(domainsLabel);
    const domainsInput = document.createElement("input");
    domainsInput.type = "text";
    domainsInput.id = "folder-smart-domains-input";
    domainsInput.placeholder = "github.com, mozilla.org";
    domainsInput.value = existingDomains.join(", ");
    domainsRow.appendChild(domainsInput);
    container.appendChild(domainsRow);

    const pinnedRow = document.createElement("div");
    pinnedRow.className = "settings-row";
    pinnedRow.style.marginTop = "6px";
    const pinnedLabel = document.createElement("label");
    pinnedLabel.textContent = "Pinned filter:";
    pinnedLabel.htmlFor = "folder-smart-pinned-select";
    pinnedRow.appendChild(pinnedLabel);
    const pinnedSelect = document.createElement("select");
    pinnedSelect.id = "folder-smart-pinned-select";
    pinnedSelect.style.cssText = "padding: 6px 8px; border: 1px solid var(--border-popup); border-radius: 4px; background-color: var(--input-bg); color: var(--input-text);";
    const optAny = document.createElement("option");
    optAny.value = "any";
    optAny.textContent = "Any";
    const optPinned = document.createElement("option");
    optPinned.value = "pinned";
    optPinned.textContent = "Pinned only";
    const optUnpinned = document.createElement("option");
    optUnpinned.value = "unpinned";
    optUnpinned.textContent = "Unpinned only";
    pinnedSelect.appendChild(optAny);
    pinnedSelect.appendChild(optPinned);
    pinnedSelect.appendChild(optUnpinned);
    pinnedSelect.value = ["any", "pinned", "unpinned"].includes(existingPinned) ? existingPinned : "any";
    pinnedRow.appendChild(pinnedSelect);
    container.appendChild(pinnedRow);

    const hint = document.createElement("div");
    hint.className = "settings-hint";
    hint.textContent = "Domains match subdomains (e.g. github.com matches docs.github.com).";
    container.appendChild(hint);

    msgEl.appendChild(container);

    const setError = (msg) => {
      const text = (msg || "").toString();
      if (!text) {
        errorEl.style.display = "none";
        errorEl.textContent = "";
      } else {
        errorEl.style.display = "";
        errorEl.textContent = text;
      }
    };

    const parseList = (value) => {
      return (value || "")
        .toString()
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
    };

    const cleanup = () => {
      backdrop.classList.remove("show");
      container.remove();
      okBtn.textContent = "OK";
      cancelBtn.textContent = "Cancel";
      okBtn.disabled = false;
      okBtn.removeEventListener("click", onSave);
      cancelBtn.removeEventListener("click", onCancel);
      setError("");
    };

    const onCancel = () => cleanup();

    const onSave = async () => {
      okBtn.disabled = true;
      setError("");

      const tags = parseList(tagsInput.value);
      const domainInputs = parseList(domainsInput.value);

      const domains = [];
      for (const raw of domainInputs) {
        const normalized = this._normalizeDomainInput(raw);
        if (!normalized) {
          okBtn.disabled = false;
          setError(`Invalid domain: ${raw}`);
          return;
        }
        domains.push(normalized);
      }

      const pinned = pinnedSelect.value;
      const updates = {
        smart: {
          enabled: !!enabledInput.checked,
          tags,
          domains,
          pinned: ["any", "pinned", "unpinned"].includes(pinned) ? pinned : "any"
        }
      };

      const result = await this._callBackgroundTask("updateFolder", {
        windowId: this.currentWindowId,
        folderId: folder.id,
        updates
      });
      const err = this._getBackgroundError(result);
      if (err) {
        okBtn.disabled = false;
        setError(err);
        return;
      }

      cleanup();
      this.folders = await this._callBackgroundTask("getFolders", { windowId: this.currentWindowId });
      document.getElementById("wsp-list").innerHTML = "";
      this.displayWorkspaces();
    };

    okBtn.textContent = "Save";
    cancelBtn.textContent = "Cancel";
    okBtn.addEventListener("click", onSave);
    cancelBtn.addEventListener("click", onCancel);
    backdrop.classList.add("show");
  }

  async _showMoveToFolderDialog(workspace) {
    const backdrop = document.getElementById("custom-dialog-backdrop");
    const msgEl = document.getElementById("custom-dialog-message");
    const inputEl = document.getElementById("custom-dialog-input");
    const colorPicker = document.getElementById("custom-dialog-colors");
    const okBtn = document.getElementById("custom-dialog-ok");
    const cancelBtn = document.getElementById("custom-dialog-cancel");

    msgEl.replaceChildren();
    const titleEl = document.createElement("strong");
    titleEl.textContent = `Move "${workspace.name}" to folder`;
    msgEl.appendChild(titleEl);
    inputEl.hidden = true;
    colorPicker.hidden = true;

    // Create folder list
    const listContainer = document.createElement("div");
    listContainer.className = "folder-select-list";
    listContainer.style.cssText = "max-height: 200px; overflow-y: auto; margin: 15px 0;";

    // "No Folder" option
    const noFolderItem = document.createElement("div");
    noFolderItem.style.cssText = "padding: 10px; border-radius: 4px; margin-bottom: 4px; background: var(--button-bg); cursor: pointer;";
    noFolderItem.textContent = "📋 No Folder (Root Level)";
    noFolderItem.addEventListener("mouseenter", () => noFolderItem.style.background = "var(--button-hover)");
    noFolderItem.addEventListener("mouseleave", () => noFolderItem.style.background = "var(--button-bg)");
    noFolderItem.addEventListener("click", async () => {
      await this._callBackgroundTask("removeWorkspaceFromFolder", {
        windowId: this.currentWindowId,
        wspId: String(workspace.id)
      });
      cleanup();
      // Refresh the list
      this.folders = await this._callBackgroundTask("getFolders", { windowId: this.currentWindowId });
      document.getElementById("wsp-list").innerHTML = "";
      this.displayWorkspaces();
    });
    listContainer.appendChild(noFolderItem);

    // Folder options
    for (const folder of this.folders) {
      const item = document.createElement("div");
      item.style.cssText = "padding: 10px; border-radius: 4px; margin-bottom: 4px; background: var(--button-bg); cursor: pointer;";
      item.textContent = `📁 ${folder.name}`;
      if (folder.color) {
        item.style.borderLeft = `4px solid ${folder.color}`;
      }

      item.addEventListener("mouseenter", () => item.style.background = "var(--button-hover)");
      item.addEventListener("mouseleave", () => item.style.background = "var(--button-bg)");
      item.addEventListener("click", async () => {
        await this._callBackgroundTask("addWorkspaceToFolder", {
          windowId: this.currentWindowId,
          wspId: String(workspace.id),
          folderId: folder.id
        });
        cleanup();
        // Refresh the list
        this.folders = await this._callBackgroundTask("getFolders", { windowId: this.currentWindowId });
        document.getElementById("wsp-list").innerHTML = "";
        this.displayWorkspaces();
      });
      listContainer.appendChild(item);
    }

    // Create new folder option
    const newFolderItem = document.createElement("div");
    newFolderItem.style.cssText = "padding: 10px; border-radius: 4px; margin-bottom: 4px; border: 1px dashed var(--border-popup); cursor: pointer; text-align: center; opacity: 0.7;";
    newFolderItem.textContent = "+ Create New Folder";
    newFolderItem.addEventListener("mouseenter", () => { newFolderItem.style.opacity = "1"; newFolderItem.style.background = "var(--button-bg)"; });
    newFolderItem.addEventListener("mouseleave", () => { newFolderItem.style.opacity = "0.7"; newFolderItem.style.background = "transparent"; });
    newFolderItem.addEventListener("click", async () => {
      cleanup();
      const folderName = await showCustomDialog({
        message: "Create folder:",
        withInput: true,
        defaultValue: "New Folder"
      });
      if (folderName && folderName !== false) {
        const folders = await this._callBackgroundTask("createFolder", {
          windowId: this.currentWindowId,
          folder: { name: folderName }
        });
        // Move workspace to the new folder
        const newFolder = folders[folders.length - 1];
        await this._callBackgroundTask("addWorkspaceToFolder", {
          windowId: this.currentWindowId,
          wspId: String(workspace.id),
          folderId: newFolder.id
        });
        // Refresh the list
        this.folders = await this._callBackgroundTask("getFolders", { windowId: this.currentWindowId });
        document.getElementById("wsp-list").innerHTML = "";
        this.displayWorkspaces();
      }
    });
    listContainer.appendChild(newFolderItem);

    msgEl.parentNode.insertBefore(listContainer, inputEl);

    okBtn.hidden = true;
    cancelBtn.textContent = "Cancel";
    backdrop.classList.add("show");

    const cleanup = () => {
      backdrop.classList.remove("show");
      listContainer.remove();
      okBtn.hidden = false;
      okBtn.textContent = "OK";
      cancelBtn.textContent = "Cancel";
      cancelBtn.removeEventListener("click", onCancel);
    };

    const onCancel = () => {
      cleanup();
    };

    cancelBtn.addEventListener("click", onCancel);
  }
}

(async () => {
  const wsp = new WorkspaceUI();
  await wsp.initialize();
})();
