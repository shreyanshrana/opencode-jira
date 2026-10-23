import type { SprintTickets, Ticket } from "./jira.ts"

export const categories = [
  { id: "in-progress", label: "In progress" },
  { id: "todo", label: "To do" },
  { id: "done", label: "Done" },
  { id: "other", label: "Other" },
] as const

export type Category = typeof categories[number]["id"]

export function sprintHeading(sprints: SprintTickets["sprints"]): string {
  if (sprints.length > 1) return "My sprints"
  return sprints[0]?.name || "My sprint"
}

export function issueTypeHue(name: string | undefined): "red" | "green" | undefined {
  switch (name?.trim().toLowerCase()) {
    case "bug": return "red"
    case "story": return "green"
    default: return undefined
  }
}

export function statusCategory(key: unknown): Category {
  if (key === "indeterminate") return "in-progress"
  if (key === "new") return "todo"
  if (key === "done") return "done"
  return "other"
}

export function groupTickets(tickets: Ticket[]): Record<Category, Ticket[]> {
  const groups: Record<Category, Ticket[]> = { "in-progress": [], todo: [], done: [], other: [] }
  for (const ticket of tickets) groups[ticket.category].push(ticket)
  return groups
}

export function sidebarRows(groups: Record<Category, Ticket[]>, collapsed: Record<Category, boolean>): string[] {
  return categories.flatMap(({ id }) => {
    if (id === "other" && !groups[id].length) return []
    return [`group/${id}`, ...(collapsed[id] ? [] : groups[id].map((ticket) => ticket.key))]
  })
}

export function moveSelection(rows: string[], current: string | undefined, delta: number): string | undefined {
  if (!rows.length) return undefined
  const index = current ? rows.indexOf(current) : -1
  return rows[Math.max(0, Math.min(rows.length - 1, index < 0 ? 0 : index + delta))]
}
