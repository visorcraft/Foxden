# AGENTS.md

This file provides guidance to AI assistants (Claude, Gemini, etc.) when working with code in this repository.

## Project Overview

Firefox Workspaces is a browser extension that groups tabs into workspaces, allowing users to switch between workspaces (hiding/showing tabs). Built with pure JavaScript using the WebExtensions API.

**Requirements:** Firefox 139.0+ (uses tabGroups API)

## Build Commands

No build tooling required. Create extension package manually:

**Windows (PowerShell):**
```powershell
Compress-Archive -Path "backend", "icons", "popup", "manifest.json" -DestinationPath "workspaces-extension.zip" -Force
```

**Linux/macOS:**
```bash
zip -r workspaces-extension.zip backend/ icons/ popup/ manifest.json
```

## Testing

Load extension temporarily via `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → select `manifest.json`

## Architecture

```
manifest.json (WebExtensions Manifest v2)
├── backend/           (Background scripts - run persistently)
│   ├── storage.js     WSPStorageManger - browser.storage.local wrapper
│   ├── workspace.js   Workspace class - single workspace entity
│   ├── brainer.js     Core orchestrator - lifecycle, events, menus
│   ├── handler.js     Message bridge between popup and background
│   └── tint.js        Dynamic icon theming based on browser theme
│
└── popup/             (Popup/Sidebar UI)
    ├── wsp.html       HTML structure (search input, workspace list, search results)
    ├── css/wsp.css    Styling with CSS variables for themes
    ├── js/wsp.js      WorkspaceUI class - rendering, CRUD, and tab search
    └── img/           Icons (copy, drag handle, folder, etc.)
```

## Key Concepts

- **Workspace**: Collection of tabs with name, color, pinned state, active state, tab groups, and lastActiveTabId
- **Storage keys**: `ld-wsp-{wspId}` for workspace data, `ld-wsp-window-{windowId}` for window-workspace mapping
- **All browser API calls are async** - use await with browser.storage, browser.tabs, etc.
- **Message passing**: Popup sends messages via `browser.runtime.sendMessage()`, handler.js routes to Brainer

## Workspace Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | number | Unique timestamp-based identifier |
| `name` | string | Display name |
| `color` | string | Hex color code (e.g., "#2196f3") or empty |
| `pinned` | boolean | Whether pinned to top of list |
| `suspended` | boolean | Whether tabs are suspended (memory freed) |
| `active` | boolean | Currently visible workspace |
| `tabs` | number[] | Array of tab IDs |
| `groups` | object[] | Tab group configurations |
| `windowId` | number | Parent window ID |
| `lastActiveTabId` | number | Last focused tab when deactivated |

## UI Components

- **Search input**: Filters tabs AND workspaces across all workspaces by title/URL; supports keyboard navigation (↑↓ to navigate, Enter to select, Escape to clear)
- **Workspace list**: Shows workspaces with pinned items at top (separated), then alphabetically; displays color indicator, tab count, empty/suspended state
- **Search results**: Shows matching workspaces first (quick switcher), then matching tabs; clicking activates workspace/tab
- **Action buttons per workspace**: Rename, Pin/Unpin, Suspend, Duplicate, Copy URLs, Delete, More (dropdown menu)
- **More actions menu**: Reload All, Mute/Unmute All, Recently Closed, Save as Template, Move to Folder, Close All Tabs
- **Color picker**: 8 preset colors in create/edit dialog
- **Footer links**: New, Templates, Export, Import, Settings
- **Folder display**: Collapsible folders containing workspaces, drag-drop support
- **Tab preview tooltip**: Shows detailed info on search result hover
- **Badge indicator**: Shows current workspace name on extension icon

## Permissions Used

- `tabs` - Manage tab visibility and grouping
- `tabHide` - Hide tabs when switching workspaces
- `tabGroups` - Firefox tab groups support
- `storage` - Local data persistence
- `menus` - Right-click context menu for moving tabs
- `downloads` - Export workspaces to JSON file
- `cookies` - Session management

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+W` | Open Workspaces popup |
| `Ctrl+Alt+Right` | Switch to next workspace |
| `Ctrl+Alt+Left` | Switch to previous workspace |
| `Alt+M` | Move current tab to another workspace |

## Message Actions (handler.js)

| Action | Description |
|--------|-------------|
| `getWorkspaces` | Get all workspaces for a window |
| `createWorkspace` | Create new workspace |
| `updateWorkspace` | Update name/color |
| `togglePinWorkspace` | Toggle pinned state |
| `duplicateWorkspace` | Clone workspace with tabs |
| `activateWorkspace` | Switch to workspace |
| `destroyWsp` | Delete workspace and its tabs |
| `suspendWorkspace` | Discard tabs to free memory |
| `unsuspendWorkspace` | Clear suspended state |
| `getRecentlyClosed` | Get recently closed tabs for workspace |
| `restoreRecentlyClosed` | Restore a recently closed tab |
| `clearRecentlyClosed` | Clear recently closed list |
| `getTemplates` | Get all saved templates |
| `saveTemplate` | Save workspace as template |
| `deleteTemplate` | Delete a template |
| `updateTemplate` | Update template name/color |
| `createFromTemplate` | Create workspace from template |
| `moveTabToWorkspace` | Move tab between workspaces |
| `getWorkspaceOrder` | Get custom workspace order |
| `saveWorkspaceOrder` | Save custom workspace order |
| `getSettings` | Get extension settings |
| `saveSettings` | Save extension settings |
| `getFolders` | Get workspace folders |
| `createFolder` | Create a new folder |
| `updateFolder` | Update folder properties |
| `deleteFolder` | Delete a folder |
| `addWorkspaceToFolder` | Move workspace into folder |
| `removeWorkspaceFromFolder` | Remove workspace from folder |

## Documentation

Detailed user-facing documentation is in `/docs`:
- `BUILDING.md` - Build prerequisites and commands
- `INSTALLATION.md` - Installation options (temporary, permanent, pre-signed)
- `SIGNING.md` - Mozilla extension signing guide
- `SECURITY.md` - Security audit results and data storage info
