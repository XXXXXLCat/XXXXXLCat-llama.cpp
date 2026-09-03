import * as React from 'react'

import {
  api,
  onLog,
  onStatus,
  type AppSettings,
  type LaunchConfig,
  type LogLine,
  type MmprojMatch,
  type ModelFile,
  type ServerStatus,
} from '@/lib/tauri-api'

const MAX_LOGS = 5000

const EMPTY_STATUS: ServerStatus = {
  running: false,
  pid: null,
  startedAt: null,
  exitCode: null,
  lastError: null,
  modelPath: null,
  mmprojPath: null,
  endpoint: null,
}

interface LauncherContextValue {
  /** Settings have been read from disk. */
  hydrated: boolean
  config: LaunchConfig
  dirty: boolean
  models: ModelFile[]
  scanning: boolean
  scanError: string | null
  status: ServerStatus
  logs: LogLine[]
  endpointUp: boolean
  mmprojMatch: MmprojMatch | null
  busy: boolean
  actionError: string | null
  updateConfig: (patch: Partial<LaunchConfig>) => void
  saveConfig: () => Promise<void>
  /** Discard unsaved edits by re-reading the persisted settings. */
  reloadConfig: () => Promise<void>
  selectModel: (path: string) => void
  selectMmproj: (path: string) => void
  refreshModels: () => Promise<void>
  startServer: () => Promise<void>
  stopServer: () => Promise<void>
  clearLogs: () => void
  dismissError: () => void
}

const LauncherContext = React.createContext<LauncherContextValue | null>(null)

export function LauncherProvider({
  children,
  fallback = null,
}: {
  children: React.ReactNode
  /** Rendered until the persisted settings have been read from disk. */
  fallback?: React.ReactNode
}) {
  const [hydrated, setHydrated] = React.useState(false)
  const [config, setConfig] = React.useState<LaunchConfig | null>(null)
  const [dirty, setDirty] = React.useState(false)
  const [models, setModels] = React.useState<ModelFile[]>([])
  const [scanning, setScanning] = React.useState(false)
  const [scanError, setScanError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<ServerStatus>(EMPTY_STATUS)
  const [logs, setLogs] = React.useState<LogLine[]>([])
  const [endpointUp, setEndpointUp] = React.useState(false)
  const [mmprojMatch, setMmprojMatch] = React.useState<MmprojMatch | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)

  const appendLogs = React.useCallback((incoming: LogLine[]) => {
    if (incoming.length === 0) return
    setLogs((prev) => {
      const next = prev.concat(incoming)
      return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next
    })
  }, [])

  // ------------------------------------------------------------- bootstrap

  React.useEffect(() => {
    let disposed = false
    const unsubs: Array<() => void> = []

    void (async () => {
      try {
        const [settings, initialLogs, initialStatus] = await Promise.all([
          api.getSettings(),
          api.getLogs(),
          api.getStatus(),
        ])
        if (disposed) return
        setConfig(settings.config)
        setLogs(initialLogs)
        setStatus(initialStatus)
      } catch (e) {
        if (!disposed) setActionError(`读取配置失败：${String(e)}`)
      } finally {
        if (!disposed) setHydrated(true)
      }

      unsubs.push(await onLog((line) => appendLogs([line])))
      unsubs.push(await onStatus(setStatus))
    })()

    return () => {
      disposed = true
      unsubs.forEach((fn) => fn())
    }
  }, [appendLogs])

  // --------------------------------------------------------- model scanning

  const modelRoot = config?.modelRoot ?? ''

  // Keep a ref so that `refreshModels` stays referentially stable — otherwise
  // editing any unrelated setting would retrigger a directory scan.
  const modelRootRef = React.useRef(modelRoot)
  modelRootRef.current = modelRoot

  const refreshModels = React.useCallback(async () => {
    const root = modelRootRef.current
    if (!root) return
    setScanning(true)
    setScanError(null)
    try {
      const found = await api.scanModelDir(root)
      setModels(found)
    } catch (e) {
      setScanError(String(e))
      setModels([])
    } finally {
      setScanning(false)
    }
  }, [])

  // Re-scan whenever the configured model root changes.
  React.useEffect(() => {
    if (!hydrated || !modelRoot) return
    void refreshModels()
  }, [hydrated, modelRoot, refreshModels])

  // ------------------------------------------------------ mmproj auto match

  const modelPath = config?.modelPath ?? ''
  const autoMmproj = config?.autoMmproj ?? false

  React.useEffect(() => {
    if (!hydrated || !autoMmproj || !modelPath) {
      setMmprojMatch(null)
      return
    }
    let cancelled = false
    void api
      .resolveMmproj(modelPath, modelRoot)
      .then((match) => {
        if (cancelled) return
        setMmprojMatch(match)
        setConfig((prev) =>
          prev && prev.autoMmproj
            ? { ...prev, mmprojPath: match.mmprojPath ?? '' }
            : prev,
        )
      })
      .catch(() => {
        if (!cancelled) setMmprojMatch(null)
      })
    return () => {
      cancelled = true
    }
  }, [hydrated, autoMmproj, modelPath, modelRoot])

  // ------------------------------------------------------------ endpoint up

  const host = config?.host ?? ''
  const port = config?.port ?? 0

  React.useEffect(() => {
    if (!status.running || !host) {
      setEndpointUp(false)
      return
    }
    let cancelled = false
    const tick = async () => {
      try {
        const up = await api.probeEndpoint(host, port)
        if (!cancelled) setEndpointUp(up)
      } catch {
        if (!cancelled) setEndpointUp(false)
      }
    }
    void tick()
    const timer = window.setInterval(tick, 2000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [status.running, host, port])

  // --------------------------------------------------------------- actions

  const updateConfig = React.useCallback((patch: Partial<LaunchConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev))
    setDirty(true)
  }, [])

  const saveConfig = React.useCallback(async () => {
    if (!config) return
    const payload: AppSettings = { config, lastModelRoot: config.modelRoot }
    await api.saveSettings(payload)
    setDirty(false)
  }, [config])

  const reloadConfig = React.useCallback(async () => {
    const settings = await api.getSettings()
    setConfig(settings.config)
    setDirty(false)
  }, [])

  const selectModel = React.useCallback((path: string) => {
    setConfig((prev) =>
      prev ? { ...prev, modelPath: path, mmprojPath: prev.autoMmproj ? '' : prev.mmprojPath } : prev,
    )
    setDirty(true)
  }, [])

  const selectMmproj = React.useCallback((path: string) => {
    setConfig((prev) => (prev ? { ...prev, mmprojPath: path, autoMmproj: false } : prev))
    setDirty(true)
  }, [])

  const startServer = React.useCallback(async () => {
    if (!config) return
    setBusy(true)
    setActionError(null)
    try {
      await api.startServer(config)
      // 启动用的是内存态 config：必须在此落盘，否则清空 dirty 后
      // 用户会误以为已保存，重启应用时参数回落到上次保存的值。
      await api.saveSettings({ config, lastModelRoot: config.modelRoot })
      const s = await api.getStatus()
      setStatus(s)
      setDirty(false)
    } catch (e) {
      setActionError(String(e))
    } finally {
      setBusy(false)
    }
  }, [config])

  const stopServer = React.useCallback(async () => {
    setBusy(true)
    setActionError(null)
    try {
      await api.stopServer()
      setStatus(await api.getStatus())
    } catch (e) {
      setActionError(String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const clearLogs = React.useCallback(() => {
    setLogs([])
    void api.clearLogs()
  }, [])

  const dismissError = React.useCallback(() => setActionError(null), [])

  const value: LauncherContextValue = React.useMemo(
    () => ({
      hydrated,
      config: config as LaunchConfig,
      dirty,
      models,
      scanning,
      scanError,
      status,
      logs,
      endpointUp,
      mmprojMatch,
      busy,
      actionError,
      updateConfig,
      saveConfig,
      reloadConfig,
      selectModel,
      selectMmproj,
      refreshModels,
      startServer,
      stopServer,
      clearLogs,
      dismissError,
    }),
    [
      hydrated,
      config,
      dirty,
      models,
      scanning,
      scanError,
      status,
      logs,
      endpointUp,
      mmprojMatch,
      busy,
      actionError,
      updateConfig,
      saveConfig,
      reloadConfig,
      selectModel,
      selectMmproj,
      refreshModels,
      startServer,
      stopServer,
      clearLogs,
      dismissError,
    ],
  )

  if (!config) {
    return <>{fallback}</>
  }

  return <LauncherContext.Provider value={value}>{children}</LauncherContext.Provider>
}

export function useLauncher(): LauncherContextValue {
  const ctx = React.useContext(LauncherContext)
  if (!ctx) {
    throw new Error('useLauncher 必须在 LauncherProvider 内部使用')
  }
  return ctx
}
