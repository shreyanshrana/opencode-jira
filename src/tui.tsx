import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { readConfig } from "./config.ts"
import { JiraClient, JiraError, type SprintTickets } from "./jira.ts"
import { openTicket } from "./open.ts"
import { Sidebar } from "./sidebar.tsx"

export default Plugin.define({
  id: "jira-sprint",
  setup(context) {
    const [data, setData] = createSignal<SprintTickets>({ sprints: [], tickets: [] })
    const [loading, setLoading] = createSignal(false)
    const [error, setError] = createSignal("")
    const [loaded, setLoaded] = createSignal(false)
    const [focusSidebar, setFocusSidebar] = createSignal<() => void>()
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let retryAt = 0
    let disposed = false
    const [maxHeight, setMaxHeight] = createSignal(12)

    async function refresh() {
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
        const client = jira ??= new JiraClient(config)
        const result = await client.load(controller.signal)
        if (!disposed) {
          setData(result)
          setError("")
          setLoaded(true)
        }
      } catch (cause) {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : "Could not load Jira tickets.")
          if (cause instanceof JiraError && cause.retryAfterSeconds) {
            delay = Math.max(delay, cause.retryAfterSeconds * 1000)
            retryAt = Date.now() + delay
          }
        }
      } finally {
        if (!disposed) {
          setLoading(false)
          timer = setTimeout(() => void refresh(), Math.min(delay, 2_147_483_647))
        }
      }
    }
    let jira: JiraClient | undefined

    async function open(url: string) {
      try {
        await openTicket(url)
      } catch {
        context.ui.toast.show({ title: "Jira", message: "Could not open the browser. Check your default browser configuration.", variant: "error" })
      }
    }

    const unregister = context.ui.slot({
      prepend: "sidebar.footer",
      render: () => <Sidebar data={data} loading={loading} loaded={loaded} error={error} maxHeight={maxHeight} refresh={refresh} open={open} registerFocus={(focus) => setFocusSidebar(() => focus)} />,
    })
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "jira-sprint.refresh",
        title: "Refresh Jira sprint tickets",
        group: "Jira",
        palette: true,
        slash: { name: "jira-refresh" },
        run: refresh,
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
