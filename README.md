# Workspaces - A Beautiful Workspace Manager for Firefox

Group your tabs into workspaces to navigate through tabs more efficiently. This extension utilizes Firefox's tab show/hide and tab groups APIs.

## Features

### Core Features
- **Create workspaces** to organize your tabs into logical groups
- **Switch workspaces** instantly - inactive tabs are hidden, keeping your tab bar clean
- **Tab search** - quickly find any tab across all workspaces by title or URL
- **Quick switcher** - search for workspaces and tabs with keyboard navigation (arrow keys + Enter)
- **Tab groups** - create tab groups within workspaces for additional organization
- **Move tabs** between workspaces via right-click context menu

### Organization
- **Workspace colors** - assign colors to workspaces for visual identification (8 preset colors)
- **Pinned workspaces** - pin important workspaces to the top of the list
- **Workspace templates** - save workspaces as reusable templates
- **Duplicate workspace** - create a copy of any workspace with all its tabs
- **Workspace folders** - group related workspaces into collapsible folders
- **Drag-and-drop reordering** - manually arrange workspaces in your preferred order

### Tab Management
- **Suspend workspaces** - free up memory by suspending inactive workspace tabs
- **Bulk operations** - reload all, mute/unmute all, close all tabs in a workspace
- **Recently closed** - restore tabs recently closed from each workspace
- **Copy URLs** - copy all tab URLs from a workspace to clipboard
- **Tab count limits** - configure warning when workspaces exceed a tab limit
- **Tab preview on hover** - see detailed tab info when hovering in search results

### Data & Backup
- **Export/Import** - backup and restore workspaces as JSON files
- **Templates** - create workspaces from saved templates

### Productivity
- **Keyboard shortcuts** - Alt+W (open popup), Alt+Shift+N (new workspace), Ctrl+Alt+Right/Left (next/previous workspace), Alt+1..9 (switch by order), Alt+Shift+F (focus search), Alt+P (quick switcher), Alt+M (move tab to workspace)
- **Theme support** - automatically adapts to your Firefox theme (light/dark)
- **Sidebar support** - access workspaces from the sidebar or popup
- **Empty workspace indicator** - visual distinction for workspaces with no tabs
- **Workspace badge indicator** - see current workspace name on the extension icon
- **Settings panel** - configure tab limits and other preferences
- **Auto-save on close** - workspaces fully restore after browser restart

## Screenshots

| ![screenshot](/screenshots/screenshot1.png) | ![screenshot](/screenshots/screenshot2.png) | ![screenshot](/screenshots/screenshot3.png) |
|---------------------------------------------|---------------------------------------------|---------------------------------------------|
| Create and manage workspaces                | Name your workspaces                        | Adapts to browser theme                     |

| ![screenshot](/screenshots/screenshot4.png) | ![screenshot](/screenshots/screenshot5.png) |
|---------------------------------------------|---------------------------------------------|
| Create tab groups within workspaces         | Move tabs between workspaces                |

---

## Quick Install

A pre-signed extension is included in this repository for direct installation:

1. Download [`workspaces-1.2.3.xpi`](workspaces-1.2.3.xpi) from this repo
2. In Firefox, go to `about:addons`
3. Click the gear icon -> **"Install Add-on From File..."**
4. Select the downloaded `.xpi` file

That's it! The extension is now permanently installed.

---

## Documentation

For detailed guides on building, installing, and signing the extension:

- [Building the Extension](docs/BUILDING.md) - Prerequisites and build commands
- [Installation Guide](docs/INSTALLATION.md) - All installation options
- [Mozilla Signing Guide](docs/SIGNING.md) - How to sign your own build
- [Security Audit](docs/SECURITY.md) - Security review and data storage info

---

## Permissions

| Permission | Purpose |
|------------|---------|
| `tabs` | Manage tab visibility and grouping |
| `tabHide` | Hide tabs in inactive workspaces |
| `tabGroups` | Manage tab groups |
| `storage` | Save workspace data locally |
| `menus` | Right-click context menu |
| `cookies` | Session management for workspace restoration |
| `downloads` | Export workspaces to JSON file |

---

## Acknowledgements

This extension is based on [fm-sys/firefox-workspaces](https://addons.mozilla.org/de/firefox/addon/firefox-workspaces/), which itself was originally based on [workspace-manager](https://addons.mozilla.org/firefox/addon/workspace-manager/).

---

## License

Mozilla Public License Version 2.0 - see [LICENSE.txt](LICENSE.txt)
