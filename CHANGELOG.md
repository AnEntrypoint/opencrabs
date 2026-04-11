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
