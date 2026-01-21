# Development

Firefox Workspaces has no build tooling, but you can run a couple of lightweight checks locally.

## Syntax check

Run:

```bash
bash scripts/check-syntax.sh
```

Or directly:

```bash
node --check backend/storage.js backend/workspace.js backend/brainer.js backend/handler.js popup/js/wsp.js
```

## Unit tests (optional)

Run:

```bash
node --test
```

