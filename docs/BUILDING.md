# Building the Extension

## Prerequisites

- Windows with PowerShell, or any system with a zip utility
- Firefox 139.0 or later

## Build Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/VisorCraft/Foxden.git
   cd Foxden
   ```

2. **Create the extension package:**

   **PowerShell (Windows):**
   ```powershell
   Compress-Archive -Path "backend", "icons", "popup", "manifest.json" -DestinationPath "workspaces-extension.zip" -Force
   ```

   **Bash (Linux/macOS):**
   ```bash
   zip -r workspaces-extension.zip backend/ icons/ popup/ manifest.json
   ```

3. Your extension package is now at `workspaces-extension.zip`

## Next Steps

- [Installation Guide](INSTALLATION.md) - How to install the built extension
- [Signing Guide](SIGNING.md) - Get your extension signed for permanent installation
