# CLAUDE.md

## Architecture

Browser app served from GH Pages. No server-side rendering. `bridge-sw.js` service worker sets COOP/COEP headers on all responses to enable `crossOriginIsolated` (required for SharedArrayBuffer/Atomics).

## WASM Caching Strategy

- `bridge-sw.js` intercepts all same-origin `.wasm` requests and caches them in Cache Storage API (`wasm-chunks` cache)
- Cache-first serving: SW returns cached response on hit; on miss, fetches, stores, and returns
- Version key stored under `cache-version` key: concatenation of `nodejs.chunks` + `|` + `layers.json` contents; on SW activate, fetches both manifests, deletes all cache entries if version changed
- `withCoi()` applied to all responses (cached and network) to set COOP/COEP/CORP headers
- Worker WASM fetches happen inside Web Workers — not interceptable via `page.on('request')`; verify via `page.evaluate(() => caches.open('wasm-chunks').then(c => c.keys()))`
- Validated: 64/64 WASM requests served from SW cache (0 network hits) on second page load; opencode layer chunks cached correctly

## Linux VM (container2wasm WASI mode)

- WASM chunks served from `/containers/nodejs*.wasm`, count from `/containers/nodejs.chunks`
- `wc.js` exports `createSystem(id, opts)` returning `{id, status, boot(), spawnShell(), destroy(), onStatus()}`; `getSystem(id)` retrieves from registry or returns null; `bootAssets()` caches CDN fetches once across all systems
- Each system owns its own `worker`, `stackWorker`, `nwStack`, `status`, and `cbs` Set — two `createSystem` calls produce two independent WASM workers
- `_registry` (Map) keyed by id; `createSystem` re-uses existing entry if id already present (resumable pattern)
- `opts.mode`: `'ephemeral'|'persistent'|'resumable'` — stored on the system object for lifecycle management by callers
- Backward-compat `boot()`, `spawnShell()`, `wcStatus()`, `onWcStatus()` delegate to the `'default'` system created at module init
- Stack worker (networking proxy) lives in `wc-stack-worker.js` — served as static file, fetched as text at boot, blobbed into a Worker
- Two workers per system: main TTY worker (runs the container WASM) + stack worker (runs `c2w-net-proxy.wasm` for HTTP proxy)
- Networking via virtual IP `192.168.127.253:80`, env vars `http_proxy`/`https_proxy`/`SSL_CERT_FILE` injected at boot
- `window.newStack`, `window.openpty`, `window.TtyServer` come from CDN UMD scripts loaded once via `bootAssets()`
- `crossOriginIsolated` is false on first visit — service worker installs, reloads page, then it's true

## Build Workflow

- `.github/workflows/build-wasm.yml` — triggers on every push to master (skips if actor is github-actions bot to avoid loops)
- Installs c2w v0.8.4 linux-amd64, runs `c2w --net=browser node:23-alpine`, splits at 50MB, names chunks `nodejs00.wasm` etc.
- Writes chunk count integer to `containers/nodejs.chunks`
- Commits and pushes `containers/` to master (requires `contents: write` permission)
- CI push pattern (both build-wasm and build-layers write-manifest): `git fetch origin master` then `git reset --soft origin/master` then `git restore --staged .` then `git add <files>` then `git commit` then `git push origin HEAD:master`; the `restore --staged` is critical — without it, workflow files from other commits get staged and GitHub rejects the bot push with "refusing to allow a GitHub App to create or update workflow"

## Non-obvious Caveats

- `wc-stack-worker.js` uses `importScripts` (not ES modules) — must be plain global JS, no `import`/`export`
- `serveIfInitMsg` in the stack worker must gate `onmessage = null` — fires on every message otherwise
- xterm-pty `loadAddon(master)` uses duck-typing, not instanceof — compatible with `@xterm/xterm` scoped package
- `window.newStack` second argument is `IMAGE_PREFIX` (string path prefix), third is chunk count (integer) — not a full URL array
- Blob workers have no base URL — `IMAGE_PREFIX` must be resolved to absolute URL (`new URL(IMAGE_PREFIX, location.href).href`) before passing to `makeWorkerBlob`
- VM boots to `/bin/sh` (busybox) via `-entrypoint /bin/sh -- -i`; the `--` separator overrides the container's baked-in CMD (`node`); `-i` makes sh interactive; `makeWorkerBlob` 5th param `cmd` (default `['-i']`) replaces what follows `--` — pass `['sh','-c','exec myapp']` to launch a specific process; `cmd` is `JSON.stringify`'d into the blob template string at call time, not at worker eval time
- `wasiHack` (TTY fd_read/fd_write/poll_oneoff patches) is defined inline in the `makeWorkerBlob` blob source in `wc-workers.js` — it is NOT in the shared CDN scripts
- Worker blob source lives in `wc-workers.js` (exported); `wc.js` handles boot orchestration only
- `appMachine` context field is `showSystems` (not `showShell`); `SHOW_SHELL` event is a kept alias that sets `showSystems` — reading `ctx.showShell` will be `undefined`, always read `ctx.showSystems`
- `appMachine` context `systems[]` shape: `{id, name, mode:'ephemeral'|'persistent'|'resumable', status, layers:[], terminals:[{id,label,cmd,wcId}], selectedTerminalId}`; `createAgentConfig` gains `systemMode` (default `'ephemeral'`)
- `components/systems-panel.js` exports `mount(el, actor)` — replaces `shell-panel.js`; left sidebar = systems list, right = terminal tabs + xterm; each terminal gets its own independent WASM worker (keyed by `wcId` in terminal record)
- `components/term-view.js` exports `mount(el, sys)` — mounts a single xterm Terminal with CanvasAddon + FitAddon into `el`, connects via `sys.spawnShell()`; returns `{dispose()}`
- `sys._onProgress` callback: set by callers (e.g. term-view.js) before boot completes; wc.js forwards `{type:'wasm-progress',loaded,total}` (per-chunk WASM fetch via `_pi` counter in worker `Promise.all`), `{type:'opfs-init',path,loaded,total}`, and `{type:'desktop-init',path,loaded,total}`; callers clear it after boot; term-view.js renders cyan `Loading WASM N/M` for wasm-progress, yellow `<path>: N/M` for opfs/desktop-init, then clears the line when shell is ready; no progress posted on cache hit — handler must tolerate zero calls
- Terminal `wcId` field: each terminal spawns its own `createSystem(wcId, { mode, layers })` worker (layers from parent system record) so multiple terminals = multiple independent workers with the correct layer WASM loaded; `_termSystems` Map in systems-panel tracks wcId→system; `window.__debug.systems` exposes it
- Ephemeral mode: when last terminal of a system is closed, all wcId workers for that system are destroyed
- `createSystem(id, {layers:['opencode','claude']})` passes layer ids; `layers.json` is source of truth for each layer's `mountPath` and `tools`; layers are OPFS mount descriptors, not WASM chunk lists
- `makeWorkerBlob(chunks, env, scripts, imagePrefix, cmd, extraUrls=[], mounts=[])` — 6th param extraUrls appended to chunk URL array; 7th param mounts=[] is array of `{vmPath, opfsPath}` (OPFS) or `{vmPath, type:'desktop'}` (desktop) mount descriptors baked into blob
- `wc-workers-desktop.js` exports `desktopBlobSrc(mounts)` — returns blob template string for desktop FS support (desktopWalk, DesktopOpenFile, DesktopPreopenDir, _desktopHandles, _desktopFiles); imported by wc-workers.js and inlined into blob source before the OPFS code
- Desktop mount flow: `opts.mounts` entries with `desktopHandle:FileSystemDirectoryHandle` are stripped to `{vmPath,type:'desktop'}` for the blob (not JSON-serializable); handles posted via `worker.postMessage({type:'desktop-handles',handles:[{vmPath,handle}]})` immediately after `new Worker()`; worker IIFE awaits this message before setting `onmessage`; write-back via `{type:'desktop-write',dh,name,data:[]}` flushed in wc.js via `dh.getFileHandle(name,{create:true}).then(fh=>fh.createWritable())`
- `_desktopHandles` Map in `systems-panel.js` (sysId→mounts[]) persists FileSystemDirectoryHandle across terminal spawns; `window.__debug.systems.desktopHandles` exposes it; showDirectoryPicker UI rendered only when `window.showDirectoryPicker` exists (Chrome/Edge); AbortError on cancel swallowed, other errors re-thrown
- Worker pre-init rendezvous always fires: even with zero desktop mounts wc.js posts `{type:'desktop-handles',handles:[]}` so worker never deadlocks waiting for the message
- `containers/layers.json` format: `{id, label, mountPath, tools:[{name, url, installCmd}]}` — mount descriptors for OPFS-backed tool storage; no chunk counts; source of truth for layer config
- Shell heredocs (`<<EOF`) inside YAML `run:` blocks break GitHub Actions YAML parsing — the unquoted content lines become bare YAML tokens; use `printf 'line1\nline2\n' > file` instead of heredocs in any `run:` step
