import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createSignal, untrack } from "solid-js"
import { readConfig } from "./config.ts"
import { cacheKey, readSnapshot, refreshCache, retryDeadline, RATE_LIMIT_MESSAGE, type CacheState, type CacheStore, type CacheSnapshot } from "./cache.ts"
import { JiraClient, JiraError, type SprintTickets } from "./jira.ts"
import { boardUrl, openJiraUrl } from "./open.ts"
import { Sidebar } from "./sidebar.tsx"

export default Plugin.define({
  id: "jira-sprint",
  setup(context) {
    const [data, setData] = createSignal<SprintTickets>({ sprints: [], tickets: [] })
    const [loading, setLoading] = createSignal(false)
    const [error, setError] = createSignal("")
    const [loaded, setLoaded] = createSignal(false)
    const [focusSidebar, setFocusSidebar] = createSignal<() => void>()
    const [shared, setShared] = createSignal<{ key: string; site: string; cache: CacheStore }>()
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let retryAt = 0
    let disposed = false
    let appliedAt = 0
    const [maxHeight, setMaxHeight] = createSignal(12)

    function apply(snapshot: CacheSnapshot) {
      setData(snapshot.data)
      setLoaded(true)
      setError("")
      appliedAt = snapshot.fetchedAt
    }

    createEffect(() => {
      const current = shared()
      if (!current || disposed) return
      const snapshot = readSnapshot(current.cache.state.snapshot, current.site)
      const cooldown = retryDeadline(current.cache.state.retryAt)
      untrack(() => {
        if (snapshot && snapshot.fetchedAt > appliedAt) apply(snapshot)
        if (cooldown > Date.now()) {
          retryAt = Math.max(retryAt, cooldown)
          setError(RATE_LIMIT_MESSAGE)
        }
      })
    })

    async function refresh(force = false) {
      if (disposed || loading()) return
      if (timer) clearTimeout(timer)
      if (Date.now() < retryAt) {
        timer = setTimeout(() => void refresh(), Math.min(retryAt - Date.now(), 2_147_483_647))
        return
      }
      setLoading(true)
      let delay = 120_000
      try {
        const config = readConfig(context.options)
        setMaxHeight(config.maxHeight)
        delay = config.refreshSeconds * 1000
        const key = cacheKey(config)
        let current = shared()
        if (current?.key !== key) {
          const [state, update] = context.storage.store<CacheState>(key, { initial: { snapshot: null, retryAt: 0 } })
          appliedAt = 0
          retryAt = 0
          setData({ sprints: [], tickets: [] })
          setLoaded(false)
          current = { key, site: config.site, cache: { state, update } }
          setShared(current)
          jira = new JiraClient(config)
        }
        const client = jira ??= new JiraClient(config)
        const result = await refreshCache(current.cache, config, (signal) => client.load(signal), controller.signal, force)
        if (!disposed) {
          if (result.snapshot) apply(result.snapshot)
          if (result.warning) setError(result.warning)
          retryAt = Math.max(retryAt, result.retryAt)
          if (result.snapshot) delay = Math.max(1000, result.snapshot.fetchedAt + config.refreshSeconds * 1000 - Date.now())
          delay = Math.max(delay, retryAt - Date.now())
        }
      } catch (cause) {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : "Could not load Jira tickets.")
          if (cause instanceof JiraError && cause.retryAfterSeconds) {
            delay = Math.max(delay, cause.retryAfterSeconds * 1000)
            retryAt = Math.max(retryAt, Date.now() + cause.retryAfterSeconds * 1000)
          }
        }
      } finally {
        if (!disposed) {
          setLoading(false)
          timer = setTimeout(() => void refresh(), Math.min(delay + Math.random() * 5000, 2_147_483_647))
        }
      }
    }
    let jira: JiraClient | undefined

    async function open(url: string) {
      try {
        await openJiraUrl(url)
      } catch {
        context.ui.toast.show({ title: "Jira", message: "Could not open the browser. Check your default browser configuration.", variant: "error" })
      }
    }

    async function openBoard() {
      try {
        const config = readConfig(context.options)
        await openJiraUrl(boardUrl(config.site, config.boardId))
      } catch {
        context.ui.toast.show({ title: "Jira", message: "Could not open the Jira board. Check your board and default browser configuration.", variant: "error" })
      }
    }

    const unregister = context.ui.slot({
      prepend: "sidebar.footer",
      render: () => <Sidebar data={data} loading={loading} loaded={loaded} error={error} maxHeight={maxHeight} refresh={() => refresh(true)} open={open} openBoard={openBoard} registerFocus={(focus) => setFocusSidebar(() => focus)} />,
    })
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "jira-sprint.refresh",
        title: "Refresh Jira sprint tickets",
        group: "Jira",
        palette: true,
        slash: { name: "jira-refresh" },
        run: () => refresh(true),
      }, {
        id: "jira-sprint.focus",
        title: "Focus Jira sprint tickets",
        group: "Jira",
        palette: true,
        enabled: () => !!focusSidebar(),
        run: () => focusSidebar()?.(),
      }],
    }))
    void refresh()
    return () => {
      disposed = true
      controller.abort()
      if (timer) clearTimeout(timer)
      unregister()
    }
  },
})
