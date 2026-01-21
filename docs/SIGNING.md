# Getting Your Extension Signed by Mozilla

If you've forked this repo or made modifications, you'll need to sign your own build. Here's how:

## Step 1: Create a Firefox Developer Account

1. Go to [addons.mozilla.org/developers](https://addons.mozilla.org/developers/)
2. Sign in with your Firefox Account (or create one)

## Step 2: Update the Extension ID

Edit `manifest.json` and change the extension ID to your own:

```json
"browser_specific_settings": {
  "gecko": {
    "id": "workspaces@YourName",
    ...
  }
}
```

## Step 3: Build the Extension

```powershell
Compress-Archive -Path "backend", "icons", "popup", "manifest.json" -DestinationPath "workspaces-extension.zip" -Force
```

Or on Linux/macOS:

```bash
zip -r workspaces-extension.zip backend/ icons/ popup/ manifest.json
```

See [BUILDING.md](BUILDING.md) for full build instructions.

## Step 4: Submit for Signing

1. Go to [addons.mozilla.org/developers/addon/submit/distribution](https://addons.mozilla.org/developers/addon/submit/distribution)
2. Select **"On your own"** (self-distribution) - this signs without public listing
3. Upload your `workspaces-extension.zip`
4. Fill in basic metadata
5. Submit for signing

## Step 5: Download and Install

1. After approval (usually automatic within minutes), download the signed `.xpi` file
2. In Firefox, go to `about:addons`
3. Click the gear icon -> **"Install Add-on From File..."**
4. Select your downloaded `.xpi` file

Your extension is now permanently installed!
