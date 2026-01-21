# Security Audit

This repository was security-audited to ensure no malicious code is present.

## Audit Results

| Check | Result |
|-------|--------|
| Network requests (fetch, XMLHttpRequest, WebSocket) | None found |
| Code obfuscation (eval, atob, Function) | None found |
| Analytics/telemetry | None found |
| Data exfiltration | None found |
| External resources | Google Fonts only (optional) |

## Data Storage

The extension stores data only in `browser.storage.local` and **never transmits data externally**.

All workspace configurations, tab groupings, and user preferences remain on your local machine.

## Permissions Explained

| Permission | Purpose |
|------------|---------|
| `tabs` | Manage tab visibility and grouping |
| `tabHide` | Hide tabs in inactive workspaces |
| `tabGroups` | Manage tab groups |
| `storage` | Save workspace data locally |
| `menus` | Right-click context menu |

All permissions are used solely for local workspace management functionality.
