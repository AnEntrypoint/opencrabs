const IDB_NAME = 'opencrabs-vfs'
const IDB_VERSION = 1
const STORE_TOOL_DATA = 'tool-data'
const STORE_METADATA = 'metadata'
const STORE_SYNC_LOG = 'sync-log'

let _db = null
let _initPromise = null

export async function initializeIDB() {
  if (_db) return _db
  if (_initPromise) return _initPromise
  _initPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onerror = () => reject(new Error('IDB open failed: ' + req.error))
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_TOOL_DATA)) {
        const store = db.createObjectStore(STORE_TOOL_DATA, {keyPath: 'key'})
        store.createIndex('toolId', 'toolId', {unique: false})
        store.createIndex('path', 'path', {unique: false})
      }
      if (!db.objectStoreNames.contains(STORE_METADATA)) {
        db.createObjectStore(STORE_METADATA, {keyPath: 'toolId'})
      }
      if (!db.objectStoreNames.contains(STORE_SYNC_LOG)) {
        const logStore = db.createObjectStore(STORE_SYNC_LOG, {keyPath: 'timestamp'})
        logStore.createIndex('toolId', 'toolId', {unique: false})
      }
    }
    req.onsuccess = () => {
      _db = req.result
      resolve(_db)
    }
  })
  return _initPromise
}

function makeKey(toolId, path) {
  return toolId + ':' + path
}

function withTransaction(stores, mode, fn) {
  return new Promise((resolve, reject) => {
    if (!_db) return reject(new Error('IDB not initialized'))
    const tx = _db.transaction(stores, mode)
    tx.onerror = () => reject(new Error('Transaction failed: ' + tx.error))
    tx.oncomplete = () => resolve()
    try {
      fn(tx)
    } catch(e) {
      reject(e)
    }
  })
}

export async function writeFile(toolId, path, data) {
  if (!(data instanceof Uint8Array)) throw new Error('data must be Uint8Array')
  await initializeIDB()
  const entry = {
    key: makeKey(toolId, path),
    toolId,
    path,
    data,
    mtime: Date.now(),
    mode: 0o100644,
    size: data.byteLength,
    syncState: 'pending'
  }
  return withTransaction([STORE_TOOL_DATA, STORE_METADATA], 'readwrite', (tx) => {
    const dataStore = tx.objectStore(STORE_TOOL_DATA)
    dataStore.put(entry)
    const metaStore = tx.objectStore(STORE_METADATA)
    metaStore.get(toolId).onsuccess = (e) => {
      const meta = e.target.result || {toolId, totalSize: 0, fileCount: 0, quotaMB: 100, lastSyncTime: 0}
      meta.totalSize += data.byteLength
      meta.fileCount += 1
      meta.lastSyncTime = Date.now()
      metaStore.put(meta)
    }
  })
}

export async function readFile(toolId, path) {
  await initializeIDB()
  return new Promise((resolve, reject) => {
    const tx = _db.transaction([STORE_TOOL_DATA], 'readonly')
    const store = tx.objectStore(STORE_TOOL_DATA)
    const req = store.get(makeKey(toolId, path))
    req.onsuccess = () => resolve(req.result?.data || null)
    req.onerror = () => reject(req.error)
  })
}

export async function listFiles(toolId) {
  await initializeIDB()
  return new Promise((resolve, reject) => {
    const tx = _db.transaction([STORE_TOOL_DATA], 'readonly')
    const store = tx.objectStore(STORE_TOOL_DATA)
    const index = store.index('toolId')
    const req = index.getAll(toolId)
    req.onsuccess = () => resolve((req.result || []).map(e => ({path: e.path, size: e.size, mtime: e.mtime})))
    req.onerror = () => reject(req.error)
  })
}

export async function deleteFile(toolId, path) {
  await initializeIDB()
  return withTransaction([STORE_TOOL_DATA, STORE_METADATA], 'readwrite', (tx) => {
    const dataStore = tx.objectStore(STORE_TOOL_DATA)
    dataStore.delete(makeKey(toolId, path))
  })
}

export async function clearTool(toolId) {
  await initializeIDB()
  return withTransaction([STORE_TOOL_DATA, STORE_METADATA], 'readwrite', (tx) => {
    const dataStore = tx.objectStore(STORE_TOOL_DATA)
    const index = dataStore.index('toolId')
    const req = index.openCursor(IDBKeyRange.only(toolId))
    req.onsuccess = (e) => {
      const cursor = e.target.result
      if (cursor) { cursor.delete(); cursor.continue() }
    }
    const metaStore = tx.objectStore(STORE_METADATA)
    metaStore.delete(toolId)
  })
}

export async function getMetadata(toolId) {
  await initializeIDB()
  return new Promise((resolve, reject) => {
    const tx = _db.transaction([STORE_METADATA], 'readonly')
    const store = tx.objectStore(STORE_METADATA)
    const req = store.get(toolId)
    req.onsuccess = () => resolve(req.result || {toolId, totalSize: 0, fileCount: 0, quotaMB: 100, lastSyncTime: 0})
    req.onerror = () => reject(req.error)
  })
}

export async function restoreForVm(toolIds) {
  await initializeIDB()
  const result = []
  return new Promise((resolve, reject) => {
    const tx = _db.transaction([STORE_TOOL_DATA], 'readonly')
    const store = tx.objectStore(STORE_TOOL_DATA)
    const index = store.index('toolId')
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error)
    for (const toolId of toolIds) {
      const req = index.getAll(toolId)
      req.onsuccess = () => {
        for (const entry of (req.result || [])) {
          result.push({path: entry.path, data: entry.data})
        }
      }
    }
  })
}

export async function logSync(toolId, path, operation, size, error) {
  if (!_db) return
  try {
    const tx = _db.transaction([STORE_SYNC_LOG], 'readwrite')
    const store = tx.objectStore(STORE_SYNC_LOG)
    store.add({
      timestamp: Date.now(),
      toolId,
      path,
      operation,
      size,
      error: error || null
    })
  } catch(e) {
    console.error('[vfs-idb] sync log failed:', e.message)
  }
}

export async function getStatus() {
  await initializeIDB()
  const tools = ['opencode', 'claude', 'kilo', 'codex']
  const status = {isInitialized: true, quotaUsed: 0, quotaLimit: 100, toolsTracked: {}}
  for (const toolId of tools) {
    try {
      const meta = await getMetadata(toolId)
      if (meta.totalSize > 0) {
        status.toolsTracked[toolId] = {totalSize: meta.totalSize, fileCount: meta.fileCount}
        status.quotaUsed += meta.totalSize
      }
    } catch(e) {}
  }
  return status
}
