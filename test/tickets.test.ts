import assert from "node:assert/strict"
import { test } from "node:test"
import type { Ticket } from "../src/jira.ts"
import { groupTickets, issueTypeHue, moveSelection, sidebarRows, sprintHeading, statusCategory, type Category } from "../src/tickets.ts"

function ticket(key: string, category: Category): Ticket {
  return { key, category, title: key, url: `https://team.atlassian.net/browse/${key}`, status: "Custom status" }
}

test("colors Bug red and Story green while keeping other types neutral", () => {
  assert.equal(issueTypeHue("Bug"), "red")
  assert.equal(issueTypeHue("Story"), "green")
  assert.equal(issueTypeHue(" BUG "), "red")
  assert.equal(issueTypeHue("story"), "green")
  assert.equal(issueTypeHue("Task"), undefined)
  assert.equal(issueTypeHue("Custom Request"), undefined)
  assert.equal(issueTypeHue(undefined), undefined)
})

test("shows the active sprint name with singular and parallel-sprint fallbacks", () => {
  assert.equal(sprintHeading([{ id: 1, name: "Sprint 42" }]), "Sprint 42")
  assert.equal(sprintHeading([]), "My sprint")
  assert.equal(sprintHeading([{ id: 1, name: "" }]), "My sprint")
  assert.equal(sprintHeading([{ id: 1, name: "Sprint 42" }, { id: 2, name: "Sprint 43" }]), "My sprints")
})

test("uses Jira status category keys and retains unknown statuses in Other", () => {
  assert.equal(statusCategory("new"), "todo")
  assert.equal(statusCategory("indeterminate"), "in-progress")
  assert.equal(statusCategory("done"), "done")
  assert.equal(statusCategory("Code review"), "other")
  assert.equal(statusCategory(undefined), "other")
})

test("groups tickets while preserving Jira rank within each stack", () => {
  const groups = groupTickets([ticket("A-1", "todo"), ticket("A-2", "done"), ticket("A-3", "in-progress"), ticket("A-4", "todo")])
  assert.deepEqual(groups.todo.map(({ key }) => key), ["A-1", "A-4"])
  assert.deepEqual(groups["in-progress"].map(({ key }) => key), ["A-3"])
  assert.deepEqual(groups.done.map(({ key }) => key), ["A-2"])
})

test("collapsed nonempty stacks keep their header and hide tickets", () => {
  const groups = groupTickets([ticket("A-1", "todo"), ticket("A-2", "done"), ticket("A-3", "in-progress")])
  const collapsed = { "in-progress": false, todo: false, done: true, other: false }
  assert.deepEqual(sidebarRows(groups, collapsed), ["group/in-progress", "A-3", "group/todo", "A-1", "group/done"])
  assert.deepEqual(sidebarRows(groups, { ...collapsed, done: false }), ["group/in-progress", "A-3", "group/todo", "A-1", "group/done", "A-2"])
})

test("unknown-category tickets remain visible and navigable", () => {
  const groups = groupTickets([ticket("A-1", "other")])
  assert.deepEqual(sidebarRows(groups, { "in-progress": false, todo: false, done: true, other: false }), ["group/in-progress", "group/todo", "group/done", "group/other", "A-1"])
})

test("keeps standard group headers visible even with zero tickets", () => {
  const collapsed = { "in-progress": false, todo: false, done: true, other: false }
  assert.deepEqual(sidebarRows(groupTickets([]), collapsed), ["group/in-progress", "group/todo", "group/done"])
  assert.deepEqual(sidebarRows(groupTickets([ticket("A-1", "todo")]), collapsed), ["group/in-progress", "group/todo", "A-1", "group/done"])
  assert.deepEqual(sidebarRows(groupTickets([ticket("A-1", "done")]), collapsed), ["group/in-progress", "group/todo", "group/done"])
  assert.deepEqual(sidebarRows(groupTickets([ticket("A-1", "todo"), ticket("A-2", "in-progress")]), collapsed), ["group/in-progress", "A-2", "group/todo", "A-1", "group/done"])
})

test("keyboard selection stays within rows and recovers after a ticket disappears", () => {
  const rows = ["group/todo", "A-1", "A-2"]
  assert.equal(moveSelection(rows, "A-1", 1), "A-2")
  assert.equal(moveSelection(rows, "A-1", -1), "group/todo")
  assert.equal(moveSelection(rows, "A-2", 1), "A-2")
  assert.equal(moveSelection(rows, "group/todo", -1), "group/todo")
  assert.equal(moveSelection(rows, "removed", 1), "group/todo")
  assert.equal(moveSelection([], undefined, 1), undefined)
})
