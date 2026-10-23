import { usePlugin } from "@opencode/plugin/tui"
import { TextAttributes } from "@opentui/core"
import type { MouseEvent, Renderable, ScrollBoxRenderable } from "@opentui/core"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import type { SprintTickets } from "./jira.ts"
import { categories, groupTickets, issueTypeHue, moveSelection, sidebarRows, type Category } from "./tickets.ts"

interface Props {
  data: Accessor<SprintTickets>
  loading: Accessor<boolean>
  loaded: Accessor<boolean>
  error: Accessor<string>
  maxHeight: Accessor<number>
  refresh: () => Promise<void>
  open: (url: string) => Promise<void>
  registerFocus: (focus: (() => void) | undefined) => void
}

function clicked(event: MouseEvent): boolean {
  if (event.button !== 0 || event.isDragging) return false
  event.stopPropagation()
  return true
}

export function Sidebar(props: Props) {
  const context = usePlugin()
  const { theme } = context
  const [collapsed, setCollapsed] = createSignal(false)
  const [closed, setClosed] = createSignal<Record<Category, boolean>>({ "in-progress": false, todo: false, done: true, other: false })
  const [selected, setSelected] = createSignal<string>()
  const [hovered, setHovered] = createSignal<string>()
  const [focused, setFocused] = createSignal(false)
  const groups = createMemo(() => groupTickets(props.data().tickets))
  const tickets = createMemo(() => new Map(props.data().tickets.map((ticket) => [ticket.key, ticket])))
  const rows = createMemo(() => sidebarRows(groups(), closed()))
  const active = () => focused() ? selected() : undefined
  const activeTicket = () => tickets().get(active() ?? "")
  let scroll: ScrollBoxRenderable | undefined
  let previousFocus: Renderable | null = null
  const rowId = (key: string) => `jira-sprint-${key.replace("/", "-")}`
  const group = (key: string) => categories.find(({ id }) => key === `group/${id}`)
  const typeColor = (name: string) => {
    const hue = issueTypeHue(name)
    return hue ? theme.hue[hue][400] : theme.text.muted
  }

  function toggle(category: Category) {
    setClosed((value) => ({ ...value, [category]: !value[category] }))
  }

  function leave() {
    if (previousFocus && !previousFocus.isDestroyed) previousFocus.focus()
    else scroll?.blur()
    setFocused(false)
  }

  function focus() {
    setCollapsed(false)
    if (context.renderer.currentFocusedRenderable !== scroll) previousFocus = context.renderer.currentFocusedRenderable
    scroll?.focus()
    setSelected((value) => value ?? rows().find((key) => !group(key)) ?? rows()[0])
  }

  function move(delta: number) {
    setSelected(moveSelection(rows(), selected(), delta))
    if (selected()) scroll?.scrollChildIntoView(rowId(selected()!))
  }

  async function activate() {
    const key = selected()
    if (!key) return
    const section = group(key)
    if (section) toggle(section.id)
    else {
      const ticket = tickets().get(key)
      if (ticket) await props.open(ticket.url)
    }
  }

  async function details() {
    const ticket = tickets().get(selected() ?? "")
    if (ticket) await context.ui.dialog.alert({ title: `${ticket.key} · ${ticket.status}`, message: ticket.title })
  }

  createEffect(() => {
    if (!rows().includes(selected() ?? "")) setSelected(rows()[0])
  })

  props.registerFocus(focus)
  context.keymap.layer(() => ({
    mode: "global",
    priority: 20,
    enabled: () => focused(),
    commands: [
      { bind: "up", run: () => move(-1) },
      { bind: "down", run: () => move(1) },
      { bind: "return", run: activate },
      { bind: "space", run: details },
      { bind: "escape", run: leave },
      { bind: "left", run: () => {
        const key = selected()
        const category = key ? group(key)?.id ?? tickets().get(key)?.category : undefined
        if (category) { setSelected(`group/${category}`); setClosed((value) => ({ ...value, [category]: true })) }
      } },
      { bind: "right", run: () => {
        const section = group(selected() ?? "")
        if (section) setClosed((value) => ({ ...value, [section.id]: false }))
      } },
    ],
  }))

  const onFocus = () => setFocused(true)
  const onBlur = () => setFocused(false)
  onCleanup(() => {
    props.registerFocus(undefined)
    if (scroll?.focused) leave()
    scroll?.off("focused", onFocus)
    scroll?.off("blurred", onBlur)
  })

  return (
    <box flexDirection="column" flexShrink={0} paddingTop={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.base} selectable={false} onMouseUp={(event) => {
          if (clicked(event)) { if (focused()) leave(); setCollapsed(!collapsed()) }
        }}><b>{collapsed() ? "▶" : "▼"} My sprint · {props.data().tickets.length}</b></text>
        <text fg={theme.text.muted} selectable={false} onMouseUp={(event) => {
          if (clicked(event)) void props.refresh()
        }}>{props.loading() ? "…" : "↻"}</text>
      </box>
      <Show when={!collapsed()}>
        <Show when={props.loading() && !props.loaded()}><text fg={theme.text.muted}>Loading Jira tickets…</text></Show>
        <Show when={props.error()}>
          <text fg={theme.text.muted} wrapMode="word">{props.error()}{props.loaded() ? " (Showing last loaded tickets.)" : ""}</text>
        </Show>
        <Show when={props.loaded() && !props.data().sprints.length && !props.error()}><text fg={theme.text.muted}>No active sprint.</text></Show>
        <Show when={props.loaded() && props.data().sprints.length > 0 && !props.data().tickets.length && !props.error()}>
          <text fg={theme.text.muted}>No tickets assigned to you.</text>
        </Show>
        <Show when={props.data().tickets.length > 0}>
          <scrollbox ref={(value) => {
            scroll = value
            value.on("focused", onFocus)
            value.on("blurred", onBlur)
          }} maxHeight={props.maxHeight()} scrollX={false} scrollY={true} flexShrink={1}>
            <For each={rows()}>{(key) => (
              <box id={rowId(key)} flexDirection="column" flexShrink={0}
                height={group(key) ? 1 : "auto"} paddingBottom={group(key) ? 0 : 1} paddingLeft={group(key) ? 0 : 2}
                backgroundColor={active() === key ? theme.background.raised.base : undefined}
                onMouseOver={() => { if (!group(key)) setHovered(key) }}
                onMouseOut={() => { if (hovered() === key) setHovered(undefined) }}
                onMouseUp={(event) => {
                  if (!clicked(event)) return
                  const section = group(key)
                  if (section) toggle(section.id)
                  else { const ticket = tickets().get(key); if (ticket) void props.open(ticket.url) }
                }}>
                <Show when={group(key)} fallback={<>
                  <text fg={theme.text.muted} height={1} wrapMode="none" truncate selectable={false} attributes={hovered() === key ? TextAttributes.UNDERLINE : 0}>
                    {key}<Show when={tickets().get(key)?.issueType}>{(type) => <> · <span style={{ fg: typeColor(type()) }}>{type()}</span></>}</Show>
                  </text>
                  <text fg={theme.text.base} wrapMode="word" flexShrink={0} selectable={false} attributes={hovered() === key ? TextAttributes.UNDERLINE : 0}>{tickets().get(key)?.title}</text>
                </>}>{(section) => (
                  <text fg={theme.text.muted} height={1} wrapMode="none" truncate selectable={false}>
                    {closed()[section().id] ? "▶" : "▼"} {section().label} · {groups()[section().id].length}
                  </text>
                )}</Show>
              </box>
            )}</For>
          </scrollbox>
          <Show when={activeTicket()}>{(ticket) => (
            <box flexDirection="column" paddingTop={1}>
              <text fg={theme.text.muted} height={1} wrapMode="none" truncate>{ticket().key} · {ticket().status}</text>
              <text fg={theme.text.base} maxHeight={3} wrapMode="word" truncate>{ticket().title}</text>
            </box>
          )}</Show>
          <Show when={focused()}>
            <text fg={theme.text.muted} height={1} wrapMode="none" truncate>↑↓ move · Enter open · Space info</text>
          </Show>
        </Show>
      </Show>
    </box>
  )
}
