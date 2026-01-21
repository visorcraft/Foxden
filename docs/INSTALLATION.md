# Installing the Extension

## Option 1: Quick Install (Pre-signed)

A pre-signed extension is included in this repository for direct installation:

1. Download [`workspaces-1.2.3.xpi`](../workspaces-1.2.3.xpi) from this repo
2. In Firefox, go to `about:addons`
3. Click the gear icon -> **"Install Add-on From File..."**
4. Select the downloaded `.xpi` file

That's it! The extension is now permanently installed.

## Option 2: Temporary Installation (for development/testing)

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click **"Load Temporary Add-on..."**
3. Select the `manifest.json` file from the project folder

> **Note:** Temporary add-ons are removed when Firefox restarts.

## Option 3: Permanent Installation (self-built)

Firefox requires extensions to be signed by Mozilla for permanent installation. If you've built your own version:

1. [Build the extension](BUILDING.md) first
2. [Get it signed by Mozilla](SIGNING.md)
3. Install the signed `.xpi` file using the Quick Install steps above
