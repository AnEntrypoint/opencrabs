## [unreleased] - 2026-04-10
- feat(systems-panel): add components/systems-panel.js replacing shell-panel.js; left sidebar with system list + status dots + mode badges; right area with terminal tabs + xterm; New System dialog with name/mode/layers; New Terminal dialog with label/cmd selector; each terminal = independent WASM worker via wcId; ephemeral destroy on last terminal close; window.__debug.systems exposed
- feat(term-view): add components/term-view.js; mounts xterm Terminal with CanvasAddon+FitAddon into element; connects via sys.spawnShell(); returns {dispose()}
- refactor: delete components/shell-panel.js
- refactor: makeWorkerBlob accepts 5th param cmd (default ['-i']); cmd replaces args after '--' separator in blob source
- refactor: wc.js singleton replaced with multi-system factory; createSystem(id,opts), getSystem(id), bootAssets() exported; backward-compat boot/spawnShell/wcStatus/onWcStatus delegate to default system


## 2026-04-10
- feat(machines): add systems+terminal lifecycle model to appMachine; rename showShell→showSystems; remove shellTab; add systems:[],selectedSystemId:null to context; add ADD/REMOVE/UPDATE/SELECT_SYSTEM and ADD/REMOVE/SELECT/UPDATE_TERMINAL events; SHOW_SHELL kept as alias; createAgentConfig gains systemMode field (default 'ephemeral')
