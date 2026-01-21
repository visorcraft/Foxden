# Building the Extension

## Automated Builds (Recommended)

The extension is built automatically via GitHub Actions:

- **Every push/PR:** Downloads available from the [Actions tab](https://github.com/VisorCraft/Foxden/actions) as artifacts
- **Version tags:** Automatically creates a [GitHub Release](https://github.com/VisorCraft/Foxden/releases) with the `.xpi` attached

To create a release:
```bash
git tag v1.0.2
git push origin v1.0.2
```

## Manual Build

If you need to build locally:

### Prerequisites

- Windows with PowerShell, or any system with a zip utility
- Firefox 147 or later

### Build Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/VisorCraft/Foxden.git
   cd Foxden
   ```

2. **Create the extension package:**

   **PowerShell (Windows):**
   ```powershell
   Compress-Archive -Path "backend", "assets/icons", "popup", "manifest.json" -DestinationPath "Foxden-extension.xpi" -Force
   ```

   **Bash (Linux/macOS):**
   ```bash
   zip -r Foxden-extension.xpi backend/ assets/icons/ popup/ manifest.json
   ```

3. Your extension package is now at `Foxden-extension.xpi`

## Next Steps

- [Installation Guide](INSTALLATION.md) - How to install the built extension
- [Signing Guide](SIGNING.md) - Get your extension signed for permanent installation
