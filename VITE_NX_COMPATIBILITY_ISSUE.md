# Nx and Vite Compatibility Issue

## Problem
There is a compatibility issue between Nx version 22.0.4 and Vite version 7.0.0. When the `@nx/vite/plugin` is enabled in `nx.json`, running Nx commands results in the following error:

```
require() of ES Module /home/all/repos/Prism/node_modules/vite/dist/node/index.js from /home/all/repos/Prism/apps/extension/vite.config.ts not supported.
Instead change the require of index.js in /home/all/repos/Prism/apps/extension/vite.config.ts to a dynamic import() which is available in all CommonJS modules.
```

## Root Cause
Vite 7.0.0 changed to be a pure ES module, which means it can no longer be required using CommonJS `require()`. However, the Nx Vite plugin (version associated with Nx 22.0.4) is attempting to load Vite using a `require()` call internally, causing the incompatibility.

## Current Status
The Vite plugin has been temporarily commented out in `nx.json` to allow Nx commands to function. The extension app can still be built and served using its `project.json` configuration.

## Recommended Solutions

### Option 1: Upgrade Nx (Recommended)
Upgrade to a newer version of Nx that supports Vite 7.0.0:
- Update Nx to version 23.0.0 or later which includes compatibility fixes for Vite 7

### Option 2: Downgrade Vite
Downgrade Vite to a version that is compatible with Nx 22.0.4:
- Change Vite version from 7.0.0 to 6.x.x in package.json

### Option 3: Wait for Nx Update
Wait for an update to the Nx Vite plugin that addresses the ES module compatibility issue.

## Temporary Workaround
The Vite plugin is currently disabled in `nx.json` to allow other Nx commands to work. The extension app can still be built using:
```bash
npx vite build --config apps/extension/vite.config.ts
```

Or through the Nx targets defined in `apps/extension/project.json`.

## Files Affected
- `nx.json` - Vite plugin is temporarily commented out
- `apps/extension/vite.config.ts` - Vite configuration file
- `apps/extension/project.json` - Project configuration for standalone builds