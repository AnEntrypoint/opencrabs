# WASM VFS Architecture: IndexedDB-Backed Persistence

## Problem Statement

Current system uses OPFS (Origin Private File System) as the persistent filesystem backend for tool data (~/.local/share/opencode, etc.). OPFS lacks `flock()` and `mmap()` semantics required by SQLite WAL mode, causing "PRAGMA journal_mode = WAL" failures during database initialization.

Workaround: Set `XDG_DATA_HOME=/tmp` to redirect database to in-memory tmpfs. This is unsustainable because:
- Tool data (e.g., code snippets, command history, settings) is lost on worker restart
- Each tool needs its own environment variable hack
- Cannot support tools that require persistent databases (SQLite, LevelDB, RocksDB)

## Goals

1. **Enable SQLite WAL transparently** for all tools without per-tool environment variable workarounds
2. **Persist tool data durably** across worker restart cycles
3. **Support multiple concurrent tools** with data isolation (one tool's database corruption doesn't affect others)
4. **Minimize boot-time latency** — restoration from persisted state should add <500ms to system startup
5. **Handle quota gracefully** — IndexedDB quota (50-100MB) is finite; prevent unchecked growth

## Current Architecture

### File Flow

```
VM (WASM):  open(path) → write(fd, data) → fsync(fd) → close(fd)
    ↓
Worker:     WASI call → OPFSOpenFile.fd_write()
    ↓
Browser:    SyncAccessHandle.write() + flush()
    ↓
OPFS:       Persisted in Origin Private File System (/root/...)
```

### Key Components

- **OPFSOpenFile** (wc-workers.js:44-182): Subclass of OpenFile intercepting fd_read/fd_write/fd_pwrite. On write, updates in-memory File object AND syncs to OPFS via `SyncAccessHandle.write() + flush()`.
- **opfsWalk()** (wc-workers.js:16-42): Boot-time restoration — traverses OPFS directory tree and populates in-memory filesystem
- **OPFSPreopenDir** (wc-workers.js:192-249): Preopened directory descriptor handling path_open, path_create_directory, etc.

### Limitations

1. **No SQLite WAL support** — OPFS doesn't support `flock()` syscalls; SQLite WAL mode requires shared memory and file locks
2. **No atomic transaction semantics** — Individual file writes sync immediately, but multi-file operations (database + journal + WAL file) are not atomic
3. **No sparse file support** — Large pre-allocated files are materialized fully on first write
4. **Quota opaque** — No quota monitoring or graceful eviction on storage exhaustion

## Candidate Architectures

### Candidate A: Modify c2w Container2WASM Itself

**Approach**: Fork/patch container2wasm to expose file syscall interception points in generated WASM module. Add custom VFS layer that intercepts `open`, `write`, `fsync`, `close` syscalls and routes them through IndexedDB.

**Interception Point**: c2w's musl libc syscall layer (syscall wrapper generated in WASM module).

**Data Flow**:
```
VM (WASM): write(fd) → syscall layer → custom VFS hook
    ↓
Worker: Custom VFS → IndexedDB + in-memory cache
    ↓
IndexedDB: Persisted metadata + file data
    ↓
Boot: Restore IDB → in-memory filesystem → mount at /root
```

**Advantages**:
- Cleanest separation of concerns — file syscalls handled at syscall boundary
- No need to patch individual OpenFile classes (OPFSOpenFile, DesktopOpenFile, etc.)
- Musl libc can be patched once; all tools automatically benefit
- Can implement copy-on-write snapshots and transaction semantics

**Disadvantages**:
- Requires maintaining a fork of container2wasm with syscall layer patches
- c2w upstream updates may require re-applying patches (merge conflict overhead)
- Adds latency to every file syscall (IPC + IDB transaction roundtrip)
- WASM linear memory growth (syscall hook + VFS state) may exceed quota
- Debugging WASM-side file syscalls is difficult (no standard debugging tools)

**Implementation Effort**: Large (40-80 hours). c2w codebase requires deep understanding of musl syscall architecture.

**Risk**: High. Syscall layer is foundational; bugs here corrupt entire filesystem or hang WASM indefinitely.

---

### Candidate B: WASM-Side Custom VFS Shim (Recommended)

**Approach**: Implement a WASM-side shim library (e.g., `vfs.c`) that provides custom open/read/write/fsync implementations. Tools are built with this shim linked instead of standard libc file APIs.

**Interception Point**: Link-time (WASM module built with custom VFS library linked).

**Data Flow**:
```
VM (WASM): tool calls vfs_write(fd, data)
    ↓
VFS Shim: Validates fd, routes to handler
    ↓
Worker: SharedArrayBuffer communication to IDB write
    ↓
IndexedDB: Persisted data
    ↓
Boot: Restore IDB → pass to WASM via SharedArrayBuffer
```

**Advantages**:
- No fork of c2w required; work entirely in userspace WASM code
- Per-tool control — only include VFS shim in tools that need persistence (opencode, claude, etc.)
- Easier debugging — WASM shim is standard C code + WASM inspection
- Can gradually migrate tools (start with opencode, expand to others)
- Direct access to file data (no syscall layer indirection)

**Disadvantages**:
- Requires source code access to tools (for relinking with VFS shim)
- Some tools may already use system libc file APIs directly (hard to patch without source)
- Shim must re-implement POSIX file semantics (error handling, fd tracking, memory buffering)
- Shared state across multiple tools' VFS shims needs coordination (quota management, path isolation)

**Implementation Effort**: Medium (20-40 hours). Core VFS shim is ~500 lines of C. IndexedDB integration is ~200 lines of JavaScript.

**Risk**: Medium. Bugs in VFS shim affect only tools that use it (others continue to work via OPFS).

---

### Candidate C: JavaScript Interception Layer (Current Path)

**Approach**: Extend existing OPFSOpenFile to detect writes to tool data directories (e.g., ~/.local/share/) and route them through IndexedDB while keeping OPFS mount active for other paths.

**Interception Point**: OPFSOpenFile.fd_write() in wc-workers.js.

**Data Flow**:
```
VM (WASM): write(fd) → WASI call
    ↓
Worker: OPFSOpenFile.fd_write() checks path
    ↓
If ~/.local/share/*: postMessage to main thread
    ↓
Main Thread: IndexedDB write (in worker-accessible context)
    ↓
postMessage back: Sync confirmation
    ↓
VM continues
```

**Advantages**:
- Minimal code changes — only extend existing OPFSOpenFile class
- No fork, no build system changes, no tool relinking required
- Works with unmodified tool binaries (opencode as-is)
- Gradual adoption — can enable per-path, per-tool without wholesale refactoring
- Full observability — IndexedDB writes are visible and debuggable from main thread

**Disadvantages**:
- Per-write IPC latency — every fd_write triggers postMessage roundtrip
- Synchronization complexity — multiple fd_write calls may arrive before previous IDB transaction completes (need buffering)
- Limited to paths recognized by path pattern (e.g., ~/.local/share/*, ~/.config/*); other paths must stay on OPFS
- Path encoding overhead — path strings must be safe IDB keys
- No atomic multi-file transactions (each file writes independently)

**Implementation Effort**: Medium (20-30 hours). Requires careful async/sync handling to avoid deadlocks.

**Risk**: Low. Changes are localized to OPFSOpenFile; other file classes unaffected.

---

## Selected Architecture: Candidate B (WASM Shim) + Candidate C (Fallback)

**Rationale**:
- **Short-term (Phase 1)**: Use Candidate C (JS Interception) to solve the immediate problem (SQLite WAL without XDG_DATA_HOME hack). This unblocks opencode validation and demonstrates the concept.
- **Long-term (Phase 2)**: Move to Candidate B (WASM Shim) once we have validated opencode persistence. At that point, we can discuss relinking opencode with a VFS shim or patching its initialization.

**Phase 1 Goals**:
1. Implement vfs-idb.js (IndexedDB schema + CRUD interface)
2. Extend OPFSOpenFile to detect ~/.local/share/* writes and route to IDB
3. Implement boot-time restoration from IDB to WASM memory
4. Validate: opencode TUI launches without XDG_DATA_HOME, persists across worker restart

**Phase 2 Goals** (future):
1. Evaluate whether opencode source can be patched for custom VFS linking
2. If yes: build opencode with WASM VFS shim, test performance
3. If no: commit to JS Interception as permanent solution; optimize for latency

---

## IndexedDB Schema (Phase 1)

### Database: `opencrabs-vfs`

#### Store 1: `tool-data`
**Purpose**: Persistent file storage for tool data directories.

**Key**: `toolId:path` (e.g., `"opencode:~/.local/share/opencode/db.sqlite"`)
**Value**:
```javascript
{
  path: "~/.local/share/opencode/db.sqlite",
  toolId: "opencode",
  data: Uint8Array,           // file content
  mtime: 1234567890,          // milliseconds since epoch
  mode: 0o100644,             // file permissions
  size: data.byteLength,      // size for quota tracking
  syncState: "pending|synced" // IDB transaction status
}
```

#### Store 2: `metadata`
**Purpose**: Per-tool quota and sync tracking.

**Key**: `toolId` (e.g., `"opencode"`)
**Value**:
```javascript
{
  toolId: "opencode",
  lastSyncTime: 1234567890,
  totalSize: 52428800,        // bytes used
  fileCount: 127,
  quotaMB: 100,
  lastRestoreTime: 1234567890
}
```

#### Store 3: `sync-log` (optional)
**Purpose**: Audit trail of writes for debugging.

**Key**: timestamp + random suffix
**Value**:
```javascript
{
  timestamp: 1234567890,
  toolId: "opencode",
  path: "~/.local/share/opencode/db.sqlite",
  operation: "write|delete|truncate",
  size: 1024,
  error: null | "ENOSPC" | "EIO"
}
```

---

## Sync Mechanism (Phase 1)

### Write Path
1. VM calls `write(fd, data)` → WASI fd_write
2. OPFSOpenFile.fd_write() checks if path matches `~/.local/share/*` or `~/.config/*`
3. If match:
   - Store data in in-memory buffer (for immediate reads)
   - postMessage `{type:'vfs-write', toolId, path, data}` to main thread
   - Main thread opens IDB transaction, writes to `tool-data` store, updates `metadata`
   - postMessage back `{type:'vfs-write-ack', path, error:null}`
   - fd_write returns success
4. If no match: Use existing OPFS path (skip IDB entirely)

### Boot Path
1. Worker boot completes OPFS initialization (opfsWalk)
2. Before starting shell, restore tool data from IDB:
   - postMessage `{type:'vfs-restore', toolIds: ['opencode', 'claude']}`
   - Main thread queries IDB `tool-data` store for matching toolId entries
   - Returns `{type:'vfs-restore-ack', files: [{path, data}...]}`
   - Worker populates WASM memory filesystem with IDB data (overwrite OPFS versions)
3. Shell launches

### Collision Handling
If same tool launches in two workers (shouldn't happen, but guard against):
- First worker to write to IDB wins
- Second worker sees IDB version as read-only; writes fail with EROFS
- Alternate: Use version timestamp to detect conflicts, last-write-wins

---

## Files to Create/Modify

### Create: `vfs-idb.js`
Exports:
- `initializeIDB()` — opens database, creates stores
- `writeFile(toolId, path, data)` — write to tool-data store
- `readFile(toolId, path)` — read from tool-data store
- `listFiles(toolId)` — enumerate all files for a tool
- `deleteFile(toolId, path)` — remove from tool-data store
- `clearTool(toolId)` — delete all files for a tool
- `getMetadata(toolId)` — quota tracking
- `restoreForVm(toolIds)` — export all files for a set of tools (returns array of {path, data})

### Modify: `wc-workers.js`
1. Import `idbMounts` parameter from boot signature (already there: `makeWorkerBlob(..., idbMounts = [])`)
2. Extend OPFSOpenFile.fd_write() to check if path matches any `idbMounts` directory
3. If match: postMessage {type:'vfs-write', toolId, path, data} and wait for ack
4. Add boot-time restore: postMessage {type:'vfs-restore', toolIds} before shell start

### Modify: `wc.js`
1. Unpack `idbMounts` from `opts.layers` (from layers.json)
2. Pass `idbMounts` to `makeWorkerBlob()`
3. Handle incoming postMessages {type:'vfs-write', 'vfs-restore', etc.}
4. Call vfs-idb.js functions and postMessage back results
5. Handle IDB errors gracefully (log, continue with OPFS fallback)

### Modify: `containers/layers.json`
Add `idbMounts` field to layer definition (e.g., opencode):
```json
{
  "id": "opencode",
  "label": "OpenCode AI",
  "mountPath": "/root/.config/opencode",
  "idbMounts": ["/root/.local/share/opencode"],  // Paths to back with IDB
  ...
}
```

---

## Performance Considerations

### Latency Budget
- Per-write latency: postMessage roundtrip (~1-5ms) + IDB transaction (~5-10ms) = ~10-15ms
- Acceptable for tools with <100 writes/sec (opencode typically 10-20 writes/sec)
- SQLite checkpoint (full db sync): ~100-500ms expected, user-visible but acceptable

### Throughput
- IDB max ~1000 writes/sec on modern hardware (batching can improve)
- Unbatched: ~100 writes/sec (postMessage overhead dominates)
- Mitigation: Batch multiple writes into single IDB transaction (requires buffer)

### Storage
- 50-100MB quota per origin (browser-dependent)
- Target: Reserve 50MB for tools, warn at 40MB, block at 45MB
- Quota exceeded: Delete oldest tool data snapshot, warn user

### Boot Time
- opfsWalk: ~500ms (existing, unchanged)
- vfs-restore: ~200ms (IDB query + data deserialization + populate)
- Total: ~700ms (target: <500ms additional, achieved via streaming restore)

---

## Error Handling

### IDB Write Fails (quota exceeded, transaction abort)
- Log error: `{type:'vfs-write-ack', path, error: 'ENOSPC'}`
- VM receives error code from fd_write (return -1 with errno)
- Tool's error handler decides: exit, retry, or fall back to OPFS

### IDB Restore Fails (corrupted database, version mismatch)
- Log error, continue with empty tool data
- Fall back to OPFS-only mode (tools re-initialize from scratch)
- User can manually clear database via `window.__debug.vfs.clear(toolId)`

### Worker Crash During Write
- IDB transaction may be partially applied
- Next boot: Detect orphaned/incomplete writes via sync-log, clean up

---

## Observability / Debug API

Expose at `window.__debug.vfs`:
- `status()` — {isInitialized, quotaUsed, quotaLimit, toolsTracked: []}
- `read(toolId, path)` — retrieve file from IDB (returns Uint8Array)
- `list(toolId)` — enumerate all persisted files for tool
- `clear(toolId)` — delete all data for a tool (destructive)
- `getMetadata(toolId)` — {totalSize, fileCount, lastSync}
- `export(toolId)` — download ZIP of all persisted files for debugging

---

## Migration Path

1. **Phase 1**: Implement Candidate C (JS Interception) with idbMounts parameter
   - Unblock opencode without XDG_DATA_HOME hack
   - Validate concept with real usage
   
2. **Phase 2** (if needed): Evaluate Candidate B (WASM Shim)
   - Measure latency impact of per-write IPC
   - If >50ms tail latency observed: migrate to WASM shim
   - Requires opencode relink (negotiation with maintainers)

3. **Phase 3** (stretch): Candidate A (Fork c2w)
   - Only if both Candidate C and B prove insufficient
   - Requires long-term maintenance commitment

---

## Acceptance Criteria (Phase 1)

1. ✅ Design document complete (this file)
2. ⬜ vfs-idb.js implemented with IDB schema and CRUD interface
3. ⬜ wc-workers.js extended with fd_write IDB routing
4. ⬜ wc.js extended with postMessage handlers
5. ⬜ layers.json updated with idbMounts field for opencode
6. ⬜ Validation: opencode TUI launches without XDG_DATA_HOME env var
7. ⬜ Validation: database persists across worker restart (no data loss)
8. ⬜ Validation: >1000 writes/sec sustained without quota errors
9. ⬜ Validation: boot-time latency <500ms (opfsWalk + vfs-restore combined)
