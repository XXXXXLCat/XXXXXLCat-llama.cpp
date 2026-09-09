import * as React from 'react'

import {
  api,
  endpointUrl,
  onLog,
  onStatus,
  type LaunchConfig,
  type LogLine,
  type MmprojMatch,
  type ModelFile,
  type ModelMeta,
  type ModelProfile,
  type DraftMatch,
  type ServerStatus,
  type SystemMetrics,
} from '@/lib/tauri-api'
import { recommendConfig } from '@/lib/model-presets'
import { useNavigate } from 'react-router-dom'

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
  models: ModelFile[]
  scanning: boolean
  scanError: string | null
  status: ServerStatus
  logs: LogLine[]
  endpointUp: boolean
  /** 系统硬件指标（CPU/console.memory/GPU），每 2 秒轮询一次 */
  metrics: SystemMetrics | null
  mmprojMatch: MmprojMatch | null
  draftMatch: DraftMatch | null
  /** 多个模型根目录（扫描时合并）。 */
  modelLibraries: string[]
  /** 用户保存的启动配置快照。 */
  profiles: ModelProfile[]
  busy: boolean
  actionError: string | null
  /**
   * 设置页的编辑草稿：独立于 config 存放，因此不会被控制台的自动落盘捎带
   * 写入；同时挂在 Provider 上，切换页面（设置页卸载/重挂）后编辑仍保留。
   * 为 null 表示没有未提交的编辑，此时设置页直接展示 config。
   */
  settingsDraft: LaunchConfig | null
  setSettingsDraft: React.Dispatch<React.SetStateAction<LaunchConfig | null>>
  /** 提交整份配置：写入内存并落盘（设置页点「保存」时使用）。 */
  commitConfig: (cfg: LaunchConfig) => Promise<void>
  /** 丢弃编辑、重读磁盘上的配置；返回读到的最新值供调用方重置草稿。 */
  reloadConfig: () => Promise<LaunchConfig>
  /** 控制台专用：改动即时落盘（无需再点保存）。 */
  applyConfig: (patch: Partial<LaunchConfig>) => void
  /** 控制台专用：选择主模型并即时落盘。 */
  applyModel: (path: string) => void
  /** 控制台专用：手动指定 mmproj 并即时落盘（同时关闭自动匹配）。 */
  applyMmproj: (path: string) => void
  /** 控制台专用：手动指定草稿模型并即时落盘（同时关闭自动匹配）。 */
  applyDraft: (path: string) => void
  /** 更新模型库列表（多根目录）并即时落盘。 */
  setModelLibraries: (libs: string[]) => void
  /** 保存/覆盖一个启动配置快照。 */
  saveProfile: (profile: ModelProfile) => Promise<void>
  /** 删除一个启动配置快照。 */
  deleteProfile: (name: string) => Promise<void>
  /** 套用一个启动配置快照（写入 config 并落盘）。 */
  applyProfile: (profile: ModelProfile) => Promise<void>
  /** 把防抖窗口内待落盘的改动立即写入（输入框失焦 / 切换标签页时调用）。 */
  flushConfigSave: () => void
  refreshModels: () => Promise<void>
  startServer: () => Promise<void>
  stopServer: () => Promise<void>
  clearLogs: () => void
  dismissError: () => void
  /** 解析单个 GGUF 的真实元数据（架构 / 上下文长度 / 量化 / 参数量等）。按需调用，不进入扫描流程。 */
  parseGguf: (path: string) => Promise<ModelMeta>
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
  // 设置页的编辑草稿（详见接口注释）：与 config 分离是本页不被捎带写入的关键。
  const [settingsDraft, setSettingsDraft] = React.useState<LaunchConfig | null>(null)
  const [models, setModels] = React.useState<ModelFile[]>([])
  const [scanning, setScanning] = React.useState(false)
  const [scanError, setScanError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<ServerStatus>(EMPTY_STATUS)
  const [logs, setLogs] = React.useState<LogLine[]>([])
  const [endpointUp, setEndpointUp] = React.useState(false)
  const [metrics, setMetrics] = React.useState<SystemMetrics | null>(null)
  const [mmprojMatch, setMmprojMatch] = React.useState<MmprojMatch | null>(null)
  const [draftMatch, setDraftMatch] = React.useState<DraftMatch | null>(null)
  const [modelLibraries, setModelLibs] = React.useState<string[]>([])
  const [profiles, setProfiles] = React.useState<ModelProfile[]>([])
  const [busy, setBusy] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)

  // ------------------------------------------------------ live persist
  // 控制台（模型 / 服务网络）的改动即时落盘，因此不需要「保存 / 还原」。
  // 文本框每敲一个字符都会触发 onChange，故统一走防抖；输入框失焦或切换
  // 标签页时由 flushConfigSave() 立即写入，避免收尾阶段丢改动。
  // 设置页不走这里：它维护本地草稿，只在点「保存」时用 commitConfig 落盘，
  // 从而不会被控制台的自动落盘捎带写入。
  const configRef = React.useRef<LaunchConfig | null>(null)
  configRef.current = config

  const persistTimer = React.useRef<number | null>(null)
  const pendingConfig = React.useRef<LaunchConfig | null>(null)

  const modelLibrariesRef = React.useRef<string[]>([])
  modelLibrariesRef.current = modelLibraries
  const profilesRef = React.useRef<ModelProfile[]>([])
  profilesRef.current = profiles

  const writeConfig = React.useCallback((cfg: LaunchConfig) => {
    void api
      .saveSettings({
        config: cfg,
        lastModelRoot: cfg.modelRoot,
        modelLibraries: modelLibrariesRef.current,
        profiles: profilesRef.current,
      })
      .catch((e) => {
        // 控制台不显示「未保存」指示器，写入失败只能靠 actionError 让用户察觉。
        setActionError(String(e))
      })
  }, [])

  const schedulePersist = React.useCallback(
    (cfg: LaunchConfig) => {
      pendingConfig.current = cfg
      if (persistTimer.current != null) window.clearTimeout(persistTimer.current)
      persistTimer.current = window.setTimeout(() => {
        persistTimer.current = null
        const next = pendingConfig.current
        pendingConfig.current = null
        if (next) writeConfig(next)
      }, 350)
    },
    [writeConfig],
  )

  const flushConfigSave = React.useCallback(() => {
    if (persistTimer.current != null) {
      window.clearTimeout(persistTimer.current)
      persistTimer.current = null
    }
    const next = pendingConfig.current
    pendingConfig.current = null
    if (next) writeConfig(next)
  }, [writeConfig])

  // 卸载时补写一次，覆盖「改完立刻关闭」落在防抖窗口内的情况。
  React.useEffect(
    () => () => {
      if (persistTimer.current == null) return
      window.clearTimeout(persistTimer.current)
      persistTimer.current = null
      const next = pendingConfig.current
      pendingConfig.current = null
      if (next) writeConfig(next)
    },
    [writeConfig],
  )

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
        setModelLibs(
          settings.modelLibraries?.length ? settings.modelLibraries : [settings.config.modelRoot],
        )
        setProfiles(settings.profiles ?? [])
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
    const roots = Array.from(new Set([root, ...modelLibrariesRef.current])).filter(Boolean)
    setScanning(true)
    setScanError(null)
    try {
      const found = await api.scanModelDirs(roots)
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
        // 自动匹配结果同样即时落盘：它是控制台内操作的衍生结果。
        const cur = configRef.current
        if (!cur || !cur.autoMmproj) return
        const next = { ...cur, mmprojPath: match.mmprojPath ?? '' }
        configRef.current = next
        setConfig(next)
        schedulePersist(next)
      })
      .catch(() => {
        if (!cancelled) setMmprojMatch(null)
      })
    return () => {
      cancelled = true
    }
  }, [hydrated, autoMmproj, modelPath, modelRoot, schedulePersist])

  // --------------------------------------------------- draft auto match

  const autoDraft = config?.autoDraft ?? false

  React.useEffect(() => {
    if (!hydrated || !autoDraft || !modelPath) {
      setDraftMatch(null)
      return
    }
    let cancelled = false
    void api
      .resolveDraft(modelPath, modelRoot)
      .then((match) => {
        if (cancelled) return
        setDraftMatch(match)
        const cur = configRef.current
        if (!cur || !cur.autoDraft) return
        const next = { ...cur, draftModelPath: match.draftPath ?? '' }
        configRef.current = next
        setConfig(next)
        schedulePersist(next)
      })
      .catch(() => {
        if (!cancelled) setDraftMatch(null)
      })
    return () => {
      cancelled = true
    }
  }, [hydrated, autoDraft, modelPath, modelRoot, schedulePersist])

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

  // --------------------------------------------------- system metrics poll

  React.useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const m = await api.getSystemMetrics()
        if (!cancelled) setMetrics(m)
      } catch {
        // 指标采集失败不影响其他功能；保留上一次成功的结果
      }
    }
    void tick()
    const timer = window.setInterval(tick, 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  // ------------------------------------------- auto open web ui on ready

  const autoOpenBrowser = config?.autoOpenBrowser ?? false
  const autoGotoWebui = config?.autoGotoWebui ?? true
  const webuiEnabled = config?.webui ?? true
  // 本 hook 的消费方（Shell 与各页面）都位于 <BrowserRouter> 内，可安全使用路由跳转。
  const navigate = useNavigate()
  const prevEndpointUp = React.useRef(false)
  // 每次「启动 → 就绪」自动执行一次（开外部浏览器 / 跳转到软件内 WebUI 页）；
  // 服务停止后复位，因此反复启停都会再次执行。单次启动内仍只执行一次：
  // 即便服务状态在就绪/未就绪之间抖动（endpointUp 反复出现上升沿），
  // 也不会反复弹窗或反复跳页。用户手动点「打开 WebUI」按钮不受此限。
  const autoOpenedRef = React.useRef(false)
  const autoGotoRef = React.useRef(false)

  React.useEffect(() => {
    // 仅在「服务就绪」上升沿触发一次。两项互相独立，各由自己的开关控制；
    // 关闭 webui 时都不执行。
    if (endpointUp && !prevEndpointUp.current && webuiEnabled) {
      // · 自动打开外部浏览器：地址经 client_host 归一化
      //   （0.0.0.0 / :: 回落 127.0.0.1），与「打开 WebUI」按钮口径一致。
      if (autoOpenBrowser && !autoOpenedRef.current) {
        autoOpenedRef.current = true
        void api.openInShell(endpointUrl(host, port))
      }
      // · 自动跳转到软件内的 WebUI 页
      if (autoGotoWebui && !autoGotoRef.current) {
        autoGotoRef.current = true
        navigate('/webui')
      }
    }
    // 服务停止时复位，使下一次「启动 → 就绪」能再次自动执行。
    if (!status.running) {
      autoOpenedRef.current = false
      autoGotoRef.current = false
    }
    prevEndpointUp.current = endpointUp
  }, [
    endpointUp,
    autoOpenBrowser,
    autoGotoWebui,
    webuiEnabled,
    host,
    port,
    status.running,
    navigate,
  ])

  // --------------------------------------------------------------- actions

  const commitConfig = React.useCallback(async (cfg: LaunchConfig) => {
    // 取消控制台防抖窗口内待写入的改动：这份草稿才是调用方认定的完整配置，
    // 若让 pending 稍后落盘，会把刚提交的内容覆盖回去。
    if (persistTimer.current != null) {
      window.clearTimeout(persistTimer.current)
      persistTimer.current = null
    }
    pendingConfig.current = null
    configRef.current = cfg
    setConfig(cfg)
    // 不在此 catch：失败要让调用方（设置页）知道，好让「未保存」保持可见。
    await api.saveSettings({
      config: cfg,
      lastModelRoot: cfg.modelRoot,
      modelLibraries: modelLibrariesRef.current,
      profiles: profilesRef.current,
    })
  }, [])

  const reloadConfig = React.useCallback(async () => {
    const settings = await api.getSettings()
    configRef.current = settings.config
    setConfig(settings.config)
    return settings.config
  }, [])

  // 控制台的实时生效版本：改内存后立即落盘，因此不需要保存动作。
  // 读取 configRef（而非闭包里的 config）可保证连续快速调用时不会互相覆盖。
  const applyConfig = React.useCallback(
    (patch: Partial<LaunchConfig>) => {
      const cur = configRef.current
      if (!cur) return
      const next = { ...cur, ...patch }
      configRef.current = next
      setConfig(next)
      schedulePersist(next)
    },
    [schedulePersist],
  )

  // 换模型后自动重算推荐参数；连续快速切换时只认最后一次请求。
  const autoRecommendSeq = React.useRef(0)

  const applyModel = React.useCallback(
    (path: string) => {
      const cur = configRef.current
      if (!cur) return
      const next = {
        ...cur,
        modelPath: path,
        mmprojPath: cur.autoMmproj ? '' : cur.mmprojPath,
        // 切换模型 = 重新自动推荐：清空手动标记，使所有受管项从「推荐」起步
        manualParams: [],
      }
      configRef.current = next
      setConfig(next)
      schedulePersist(next)

      // 按「模型 + 硬件」自动重算推荐参数，仅覆盖未被用户手动改过的键。
      const seq = ++autoRecommendSeq.current
      void (async () => {
        let meta: ModelMeta
        try {
          meta = await api.parseGguf(path)
        } catch {
          return // 元数据解析失败不阻塞选择模型
        }
        if (seq !== autoRecommendSeq.current) return

        const file = models.find((m) => m.path === path)
        const gpu = metrics?.gpus?.[0] ?? null
        const rec = recommendConfig(
          {
            sizeBytes: file?.sizeBytes ?? 0,
            blockCount: meta.blockCount,
            embeddingLength: meta.embeddingLength,
            headCountKv: meta.headCountKv,
            keyLength: meta.keyLength,
            contextLength: meta.contextLength,
            tensorDataLayout: meta.tensorDataLayout,
            architecture: meta.architecture,
            expertCount: meta.expertCount,
            domain: meta.domain,
          },
          {
            vramTotalBytes: gpu?.memory_total ?? null,
            ramTotalBytes: metrics?.memory_total ?? null,
            cpuPhysicalCount: metrics?.cpu_physical_count ?? null,
            cpuCount: metrics?.cpu_count ?? null,
          },
        )
        if (seq !== autoRecommendSeq.current) return

        const manual = new Set(configRef.current?.manualParams ?? [])
        const patch: Record<string, unknown> = {}
        const put = (key: string, value: unknown) => {
          if (!manual.has(key)) patch[key] = value
        }
        // 卸载模式与层数是一组：任一被手动改过就整组跳过，避免组合不自洽
        if (!manual.has('gpuLayersMode') && !manual.has('gpuLayersValue')) {
          patch.gpuLayersMode = rec.gpuLayersMode
          patch.gpuLayersValue = rec.gpuLayersValue
        }
        put('ctxSize', rec.ctxSize)
        put('cacheTypeK', rec.cacheTypeK)
        put('cacheTypeV', rec.cacheTypeV)
        put('batchSize', rec.batchSize)
        put('ubatchSize', rec.ubatchSize)
        put('threads', rec.threads)
        put('flashAttn', rec.flashAttn)
        // 采样推荐（server-side 默认采样参数），同样按「未手动改过才覆盖」
        put('temp', rec.temp)
        put('topK', rec.topK)
        put('topP', rec.topP)
        put('minP', rec.minP)
        put('repeatPenalty', rec.repeatPenalty)
        put('presencePenalty', rec.presencePenalty)
        applyConfig(patch as Partial<LaunchConfig>)
      })()
    },
    [schedulePersist, applyConfig, models, metrics],
  )

  const applyMmproj = React.useCallback(
    (path: string) => {
      const cur = configRef.current
      if (!cur) return
      const next = { ...cur, mmprojPath: path, autoMmproj: false }
      configRef.current = next
      setConfig(next)
      schedulePersist(next)
    },
    [schedulePersist],
  )

  const applyDraft = React.useCallback(
    (path: string) => {
      const cur = configRef.current
      if (!cur) return
      const next = { ...cur, draftModelPath: path, autoDraft: false }
      configRef.current = next
      setConfig(next)
      schedulePersist(next)
    },
    [schedulePersist],
  )

  // 更新模型库（多根目录）：去重、trim 后落盘，并立即重新扫描。
  // 注意：保留空字符串（不 filter Boolean），否则「添加目录」新增的空输入框会被立即丢弃。
  const setModelLibraries = React.useCallback(
    (libs: string[]) => {
      const next = Array.from(new Set(libs.map((l) => (l ?? '').trim())))
      modelLibrariesRef.current = next
      setModelLibs(next)
      void api
        .saveSettings({
          config: configRef.current ?? ({} as LaunchConfig),
          lastModelRoot: configRef.current?.modelRoot ?? '',
          modelLibraries: next,
          profiles: profilesRef.current,
        })
        .catch((e) => setActionError(String(e)))
      void refreshModels()
    },
    [refreshModels],
  )

  const saveProfile = React.useCallback(async (profile: ModelProfile) => {
    await api.saveProfile(profile)
    const next = profilesRef.current.filter((p) => p.name !== profile.name)
    next.push(profile)
    profilesRef.current = next
    setProfiles(next)
  }, [])

  const deleteProfile = React.useCallback(async (name: string) => {
    await api.deleteProfile(name)
    const next = profilesRef.current.filter((p) => p.name !== name)
    profilesRef.current = next
    setProfiles(next)
  }, [])

  const applyProfile = React.useCallback(async (profile: ModelProfile) => {
    const cur = configRef.current
    if (!cur) return
    const next: LaunchConfig = {
      ...cur,
      modelPath: profile.modelPath,
      mmprojPath: profile.mmprojPath,
      draftModelPath: profile.draftModelPath,
      ctxSize: profile.ctxSize,
      gpuLayersMode: profile.gpuLayersMode,
      gpuLayersValue: profile.gpuLayersValue,
      flashAttn: profile.flashAttn,
    }
    configRef.current = next
    setConfig(next)
    await api.saveSettings({
      config: next,
      lastModelRoot: next.modelRoot,
      modelLibraries: modelLibrariesRef.current,
      profiles: profilesRef.current,
    })
  }, [])

  const startServer = React.useCallback(async () => {
    if (!config) return
    setBusy(true)
    setActionError(null)
    try {
      await api.startServer(config)
      // 启动用的是内存态 config：在此落盘，确保重启后参数与本次启动一致。
      await api.saveSettings({
        config,
        lastModelRoot: config.modelRoot,
        modelLibraries: modelLibrariesRef.current,
        profiles: profilesRef.current,
      })
      const s = await api.getStatus()
      setStatus(s)
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

  // 解析 GGUF 元数据：纯透传，由调用方负责缓存与错误展示。
  const parseGguf = React.useCallback((path: string) => api.parseGguf(path), [])

  const value: LauncherContextValue = React.useMemo(
    () => ({
      hydrated,
      config: config as LaunchConfig,
      settingsDraft,
      setSettingsDraft,
      models,
      scanning,
      scanError,
      status,
      logs,
      endpointUp,
      metrics,
      mmprojMatch,
      draftMatch,
      modelLibraries,
      profiles,
      busy,
      actionError,
      commitConfig,
      reloadConfig,
      applyConfig,
      applyModel,
      applyMmproj,
      applyDraft,
      setModelLibraries,
      saveProfile,
      deleteProfile,
      applyProfile,
      flushConfigSave,
      refreshModels,
      startServer,
      stopServer,
      clearLogs,
      dismissError,
      parseGguf,
    }),
    [
      hydrated,
      config,
      settingsDraft,
      setSettingsDraft,
      models,
      scanning,
      scanError,
      status,
      logs,
      endpointUp,
      metrics,
      mmprojMatch,
      draftMatch,
      modelLibraries,
      profiles,
      busy,
      actionError,
      commitConfig,
      reloadConfig,
      applyConfig,
      applyModel,
      applyMmproj,
      applyDraft,
      setModelLibraries,
      saveProfile,
      deleteProfile,
      applyProfile,
      flushConfigSave,
      refreshModels,
      startServer,
      stopServer,
      clearLogs,
      dismissError,
      parseGguf,
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
