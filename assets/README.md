# assets/

Master imagery for Foxden. Every other reproduction of the lantern
mark across the repository (the Firefox `browser_action` /
`sidebar_action` icons in `manifest.json`, README hero) is a derived
raster that should trace back to these files.

| File | Size | Purpose |
| ---- | ---- | ------- |
| `Foxden_lantern.png` | 1024×1024 | Master square icon — the brass lantern mark. Use this whenever you need a high-resolution square logo (stores, slides, addon listings). All `icons/*.png` are derived from it. |
| `Foxden.ico` | 16/32/48/64/128/256 | Multi-resolution Windows-style icon, for any tooling that prefers `.ico` (favicons, browser bookmarks, GitHub repo). |
| `Foxden.png` | 1022×695 | The "fox curled up in a den" README hero. Wide composition — pair with the lantern mark, do not substitute. |
| `social-1024x512.png` | 1024×512 | GitHub social preview / OpenGraph card. Upload via **Settings → Social preview** on github.com. |
| `splash-screen.png` | 800×500 | Reserved for any future in-product splash. Same palette as the social card. |
| `icons/` | 16–512 px | Per-size PNGs derived from `Foxden_lantern.png`. Used by `manifest.json` (`128x128.png`, `64x64.png`) and available for other tooling. |
| `screenshots/` | varied | UI screenshots referenced from `README.md` (workspaces sidebar, settings, folder rules, move-tab menu). |

The brand is currently shipped only as rasters (no SVG master). If a
vector lantern is added later, drop `Foxden_lantern.svg` here and
re-export every PNG size from it.

## Regenerating from the master square PNG

```sh
# Per-size PNGs (Firefox + general use)
for s in 16 32 48 64 96 128 256 512; do
  magick assets/Foxden_lantern.png -filter Lanczos -resize ${s}x${s} \
    assets/icons/${s}x${s}.png
done

# Multi-resolution ICO
magick assets/icons/16x16.png assets/icons/32x32.png \
       assets/icons/48x48.png assets/icons/64x64.png \
       assets/icons/128x128.png assets/icons/256x256.png \
       assets/Foxden.ico
```

## Where else the lantern lives in the repository

- `manifest.json` references `assets/icons/128x128.png` (extension
  icon) and `assets/icons/64x64.png` (browser/sidebar action). If the
  brand mark changes, update `assets/Foxden_lantern.png` first, then
  re-run the regeneration commands above so those derived sizes pick
  up the new master.
- `README.md` embeds `assets/Foxden.png` as the hero and the files in
  `assets/screenshots/` as the in-product preview row.
