## [unreleased]
- fix(layers): add extraEnv support to layers.json and wc-layer-install.js — layers can now specify env vars injected at boot; opencode sets XDG_DATA_HOME=/tmp so SQLite database lives in tmpfs instead of OPFS; fixes "Failed to run the query 'PRAGMA journal_mode = WAL'" error caused by OPFS lacking flock/mmap semantics required by SQLite WAL mode
- validated: opencode musl binary (162MB) executes in browser WASM Alpine Linux terminal — `which opencode` returns /root/.local/bin/opencode; `od -c` shows ELF magic bytes; binary runs 3-5s before timeout (TUI app, initializes alternate terminal buffer, output cleared on exit); 27771 bright pixels on xterm canvas confirming terminal renders; GCC 15 libs baked into WASM base image (no LD_PRELOAD needed); OPFS execute permission patch (5 patches) enables binary execution from OPFS mount
- fix(build-wasm): bake GCC 15 libs into alpine WASM image — multi-stage Dockerfile copies libstdc++.so.6+libgcc_s.so.1 from alpine:edge into alpine:3.20 /usr/lib; linker finds them on default path without LD_PRELOAD/LD_LIBRARY_PATH; eliminates OPFS lib install and removes OPFS path resolution issues
- fix(build-wasm): add VM_MEMORY_SIZE_MB=512 to c2w build — default 115MB Linux VM RAM is too small for opencode's 162MB musl binary (OOM/Killed); 512MB VM memory allows opencode to load and execute
- fix(layers): replace WASM layer concatenation with OPFS binary install — fetch opencode musl binary from npmjs tgz, extract via streaming tar parser, write to OPFS /root/.local/bin; fetch Alpine GCC 15 libgcc_s.so.1 + libstdc++.so.6 to /root/.local/lib; set LD_LIBRARY_PATH and prepend PATH; WASM patches for OPFS file execute permissions (S_IFREG|0755)
- fix(layers): upgrade libgcc/libstdc++ to Alpine edge GCC 15.2.0 — opencode binary compiled with GCC 15 (Alpine edge), GCC 13 libs caused symbol mismatch; replace containers/libgcc_s.so.1 + libstdc++.so.6 with Alpine edge GCC 15.2.0-r3 packages

## [unreleased]
- fix(layers): pass layer binaries as transferables to worker instead of re-opening IDB — blob: URL workers have null origin; indexedDB.open('opencrabs-layers') in worker accessed null-origin IDB (not main page's http://127.0.0.1:7071 IDB); layer binary was never found; fix: read binary from IDB in main page context via idbGet(), pass as layerBuffers ArrayBuffer transferable alongside wasmBuffers in desktop-handles message; worker uses _init.layerBuffers directly; idbGet exported from wc-layer-install.js

## [unreleased]
- feat(wc): replace layer WASM concatenation with OPFS binary install — layers.json gains binaryUrl/binaryName/binaryVmPath; wc-layer-install.js fetches tgz from CDN, extracts binary via streaming tar parser with DecompressionStream, writes to OPFS tools/{id}/; mounts OPFS dir at binaryVmPath and prepends to PATH per system; no layer WASMs needed
- fix(build-layers): disable build-layers.yml workflow (layer WASMs superseded by OPFS binary install)
- fix(build-layers): multi-stage opencode Dockerfile — alpine:3.20 final with only musl binary, no node/npm; WASM_MEM_SIZE=536870912 for opencode c2w; other layers use node:23-alpine single-stage; minimizes opencode WASM image size
- fix(wc): filter CPR escape sequences (ESC[row;colR) from pty slave.read() via regex proxy — prevents ^[[N;5R terminal pollution on xterm init for perfect PTY emulation
- fix(build-layers): add --no-cache to docker build to prevent Docker layer cache reuse causing stale npm install (opencode layer was 3 chunks instead of expected 8+)
- validated: opencode layer (3 chunks, alpine:3.20 multi-stage) boots in browser WASM terminal — 6146 bright pixels with ANSI colors (cyan, white, amber) confirmed via xterm-text-layer canvas; claude layer (7 chunks, node:23-alpine) boots sh -i, responds to echo, claude --version produces 5191 bright pixels / 69 rows of output confirming claude-code binary runs inside WASM VM
- fix(build-layers): opencode uses multi-stage Dockerfile — npm install in node:23-alpine build stage, COPY binary to alpine:3.20 final stage; eliminates node/npm from final image (~700 MB savings); other layers add npm cache clean --force; opencode WASM target <1 GB
- fix(wc): add /root/.bun/bin to PATH in SHELL_ENV so bun-installed binaries (claude, opencode, kilo, codex) are found when layer WASM built with bun install -g
- fix(build-layers): remove bun from layer Dockerfile; all packages support npm postinstall fallback; opencode-ai ships prebuilt musl binary (155 MB) so bun runtime not needed; drops WASM from 1.511 GB to ~855 MB, under Chrome 1 GB WebAssembly module size limit
- fix(systems-panel): fix cmd construction — remove leading 'sh' from cmd array; WASM entrypoint is already /bin/sh via -entrypoint flag; ['sh','-c','exec opencode'] caused sh to try to open a file named 'sh'; fix: ['-c','exec opencode']
- fix(wc-workers): use WebAssembly.compileStreaming(fetch(blobUrl)) instead of WebAssembly.instantiate(buffer) — compileStreaming bypasses Chrome's 1 GB buffer limit; opencode WASM alone is 1.51 GB which exceeds instantiate() max; blob URL created from merged Uint8Array, revoked after compile
- fix(wc): skip nodejs base chunks when layer extraUrls present — layer WASMs (built from node:23-alpine) include node; concatenating base+layer = 1.62 GB, exceeding Chrome's 1 GB WebAssembly.instantiate() limit; fix: baseUrls=[] when extraUrls.length>0
- fix(wc): fetch WASM chunks in batches of 4 instead of all-concurrent Promise.all — prevents ERR_FAILED on GH Pages when 32×50MB requests fire simultaneously
- fix(wc): delay TtyServer.start 50ms after PTY addon load to prevent CPR escape codes (^[[1;5R) in stdin — xterm sends ESC[6n cursor position request on init; response flows PTY→WASM stdin before shell ready; fix: onData({xtermAddon:master}) first, then 50ms, then TtyServer.start
- ci(build-layers): add matrix workflow to build opencode/claude/kilo/codex layer WASMs via c2w from node:23-alpine + bun + pkg; splits at 50MB; commits layer-{id}*.wasm + layer-{id}.chunks per matrix job; continue-on-error per job; skips bot actor
- fix(build-layers): retry push loop (5 attempts, exponential backoff) in commit step to handle concurrent matrix job push collisions; all 4 layers validated deployed: opencode=29 chunks, claude=18, kilo=33, codex=20

## [unreleased]
- fix(wc-workers): buffer messages during OPFS init — onmessage=null silently dropped {type:'init'} from newStack; streamCtrl never set; recvCert() hung; WASM never started; fix: _pending buffer replays all messages after opfsMounts resolves
- fix(wasm-cache): move WASM fetch to main thread with explicit Cache API cache-first; blob Workers have null origin and bypass SW; fetched ArrayBuffers transferred to Worker eliminating duplicate download; SW WASM cache now populates correctly on first boot
- fix(sw): add invalidateOnVersionChange to install handler; change SW bytes to force browser re-install; add await to cache.put in .wasm handler
- fix(header): add stable id to terminal status chip to prevent webjsx applyDiff from setting id=undefined
- fix(containers): delete stale nodejs03-05.wasm from remote master (leftover from old node:23-alpine CI build; current alpine:3.20 produces only 3 chunks nodejs00-02)
- fix(serve): add .wasm MIME type to bin/serve.js so local dev server serves WASM with application/wasm content-type

## [unreleased]
- feat(systems-panel-progress): wasm-progress postMessage per chunk in worker; forwarded via _onProgress; xterm shows cyan "Loading WASM N/M" vs yellow opfs progress
- feat(systems-panel-progress): term-view shows "Booting..." then writes \r-overwriting progress lines for opfs-init and desktop-init events; clears after boot; wc-workers-desktop.js: remove unused _desktopVmPaths dead code
- feat(desktop-fs): add desktop FileSystem mount; showDirectoryPicker in New System dialog (hidden when API unavailable); desktopWalk loads dir tree into RAM via getFile().arrayBuffer(); DesktopOpenFile/DesktopPreopenDir classes with write-back via desktop-write postMessage; worker pre-init desktop-handles rendezvous; wc-workers-desktop.js splits desktop blob src; wc.js posts handles before TtyClient init and flushes writes via createWritable; backward-compat: OPFS mounts unchanged

## [unreleased]
- fix(build-wasm): move c2w output and Dockerfile to workspace dir to avoid /tmp/snap-private-tmp permission denied on ubuntu-latest runners
- feat(opfs): add OPFS-backed persistent filesystem in worker blob; OPFSOpenFile writes sync to OPFS via createSyncAccessHandle; default /root mount; progress messages {type:'opfs-init'} forwarded via wc.js onProgress
- ci(build-wasm): switch to alpine:3.20 base WASM; remove build-layers.yml and all layer WASM/chunks from containers/
- refactor(layers): redesign layers.json as mount descriptors with mountPath and tools array; remove chunk counts - 2026-04-11
- refactor(vendor-xterm): download xterm@5.5.0, addon-fit@0.10.0, addon-canvas@0.7.0 UMD files to vendor/; embed xterm.css into styles.css; rewrite term-view.js to inject script tags from vendor paths and use window.Terminal/FitAddon/CanvasAddon globals; remove esm.sh dynamic imports
- fix(systems-panel,wc): wire terminal cmd to WASM entrypoint; mountTerminal derives cmd array from term.cmd and passes to createSystem; createSystem passes opts.cmd to makeWorkerBlob so 'opencode', 'claude', etc. run as VM entrypoint instead of sh -i

## [unreleased]

### Fixed
- fix(build-layers,build-wasm): add git restore --staged after reset --soft so bot push never includes workflow files (prevents "refusing to allow GitHub App to update workflow" rejection)

## [unreleased]

### Fixed
- fix(build-wasm): fetch origin/master and reset --soft before commit to avoid push rejection when layer builds have already pushed during the same trigger

## [unreleased] - 2026-04-11
- feat(bridge-sw): cache WASM chunks in Cache Storage with version-keyed invalidation; invalidate on SW activate when nodejs.chunks or layers.json content changes
- fix(build-layers): write-manifest job now fetches origin/master and resets --soft before committing to avoid ref lock failures on force-push during concurrent long-running builds
- validated: 64/64 WASM requests served from SW cache (0 network hits) on second page load; all 25 opencode layer chunks cached; system boots to ready from cache

## [unreleased] - 2026-04-10
- fix(systems-panel): pass layers to createSystem in mountTerminal so each terminal's WASM worker receives layer URLs (commit a81c039)
- feat(systems-panel): add components/systems-panel.js replacing shell-panel.js; left sidebar with system list + status dots + mode badges; right area with terminal tabs + xterm; New System dialog with name/mode/layers; New Terminal dialog with label/cmd selector; each terminal = independent WASM worker via wcId; ephemeral destroy on last terminal close; window.__debug.systems exposed
- feat(term-view): add components/term-view.js; mounts xterm Terminal with CanvasAddon+FitAddon into element; connects via sys.spawnShell(); returns {dispose()}
- refactor: delete components/shell-panel.js
- refactor(app-systems-wire): app.js imports mount from systems-panel.js instead of shell-panel.js
- feat(ci-layers): add .github/workflows/build-layers.yml; matrix builds 4 tool layers (opencode-ai, @anthropic-ai/claude-code, kilo-code, @openai/codex); writes containers/layers.json after all matrix jobs; continue-on-error:true per job; skips bot actor
- feat(wc-layers): createSystem() accepts opts.layers[]; fetchLayerUrls() resolves layer chunk counts and builds extra URLs; makeWorkerBlob() gains 6th param extraUrls=[] appended to chunk URL list
- refactor: makeWorkerBlob accepts 5th param cmd (default ['-i']); cmd replaces args after '--' separator in blob source
- refactor: wc.js singleton replaced with multi-system factory; createSystem(id,opts), getSystem(id), bootAssets() exported; backward-compat boot/spawnShell/wcStatus/onWcStatus delegate to default system


## 2026-04-10
- feat(machines): add systems+terminal lifecycle model to appMachine; rename showShell→showSystems; remove shellTab; add systems:[],selectedSystemId:null to context; add ADD/REMOVE/UPDATE/SELECT_SYSTEM and ADD/REMOVE/SELECT/UPDATE_TERMINAL events; SHOW_SHELL kept as alias; createAgentConfig gains systemMode field (default 'ephemeral')

## 2026-04-10
- fix(systems-panel): always show layers section in New System dialog; await fetchLayers before open; show CI-build-pending msg when layers.json empty
- fix(systems-panel): reset el._sysId on system switch to prevent stale tabbar/termwrap
- fix(systems-panel): pass sysId not sysRecord to openNewTermDialog to avoid stale closure
- fix(systems-panel): reset termwrap._tid=null when no terminal selected
- fix(term-view): improve unavailable-status error message clarity
- fix(wc): boot() throws on crossOriginIsolated=false instead of silent return
- feat(wc): fetchLayerUrls() + opts.layers support for WASM layer concatenation
- fix(build-layers): docker build image first, then pass tag to c2w; fix heredoc quoting
- validated: systems panel e2e — new-system dialog, system creation, terminal mount, xterm canvas
