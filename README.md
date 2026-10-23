# OpenCode Jira Plugin

A plugin for OpenCode that pins your Jira tickets to the bottom of the right sidebar.

```text
▼ Sprint 42 · 3                   ↻
▼ In progress · 1
  TEAM-5050 · Task
  Collect all pokemon

▼ To do · 1
  TEAM-5051 · Bug
  Fix login redirect

▶ Done · 1
```

- Only issues assigned to the authenticated Jira user (`assignee = currentUser()`).
- Only active sprints on your configured Scrum board. Parallel active sprints are combined and duplicate tickets removed.
- The heading shows the active sprint's name. With parallel active sprints, it shows **My sprints** and lists their names underneath when expanded. Long names wrap without hiding the refresh control.
- Tickets are grouped by Jira status category: **In progress**, **To do**, then **Done** (collapsed initially). Custom workflow names map to their Jira categories, not their labels. Tickets without a recognized category appear in **Other**.
- Standard status group headings stay visible even when empty, including **To do** and **In progress**. **Other** appears only when needed.
- Rows show a muted key and Jira issue type (for example, `TEAM-5050 · Task`) above the full title, wrapping across as many lines as needed. Custom issue type names are supported; missing type metadata is simply omitted. Hover underlines the key and title to identify the clickable ticket, without changing its background. Click anywhere on a ticket row to open it in your default browser.
- Click section headings to collapse them. All stacks share a bounded scroll area; refreshes retain group state and ticket keys so the list does not reset unnecessarily.
- **Bug** issue-type labels are red and **Story** labels are green, using the selected theme's palette. Ticket numbers and other issue types remain muted.
- Choose **Focus Jira sprint tickets** in the command palette for keyboard navigation: ↑/↓ select, Enter opens a ticket or toggles a group, ←/→ fold/unfold a group, Space shows the complete title and workflow status, Esc returns to the previous input. Keyboard-selected tickets also get a short title preview.
- Click ↻ or run `/jira-refresh` to refresh.
- Automatic refresh every two minutes. Failed refreshes retain the last successful list with an error indicator.
- Runs locally in the CLI, including when connected to a remote OpenCode server. No Jira data is sent to the model.

Requires **OpenCode V2 2.1.2+**, Jira Cloud, and a Scrum board. Not compatible with OpenCode V1 or Jira Data Center. The sidebar must be visible and terminal mouse capture enabled for clicking. The section sits immediately above the existing sidebar footer (project path).

## Authentication: API token with scopes

Create an [Atlassian API token with scopes](https://id.atlassian.com/manage-profile/security/api-tokens), choose Jira, and select:

```text
read:sprint:jira-software
read:issue-details:jira
read:jql:jira
```

No write, delete, admin, board-discovery, or profile scopes are needed. Your account must also have permission to view the board and its issues. This plugin supports **scoped API tokens only**, not OAuth or unscoped legacy tokens.

Set these environment variables in the shell that launches OpenCode:

```sh
export JIRA_EMAIL="you@example.com"
export JIRA_API_TOKEN="your-scoped-api-token"
```

Prefer loading the token from your password manager rather than typing it into shell history. Never commit it or put it in plugin options. Restart OpenCode after changing credentials. Tokens expire; replace the environment value when rotating them.

Requests use Basic authentication with `email:token` against `https://api.atlassian.com/ex/jira/{cloudId}`. Credentials are never sent to the configured site. The plugin discovers the cloud ID through an unauthenticated `https://<site>/_edge/tenant_info` request, or accepts an explicit `cloudId` option / `JIRA_CLOUD_ID` environment variable.

## Install globally

Install the published [opencode-jira](https://www.npmjs.com/package/opencode-jira) plugin by adding the following entry to the `plugins` array in `~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json`). Preserve existing entries and settings:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    {
      "package": "opencode-jira",
      "options": {
        "boardUrl": "https://your-team.atlassian.net/jira/software/c/projects/TEAM/boards/173"
      }
    }
  ]
}
```

Replace `boardUrl` with your own Jira Scrum board URL and set `JIRA_EMAIL` and `JIRA_API_TOKEN` as described in [Authentication](#authentication-api-token-with-scopes).

OpenCode downloads the npm package automatically. No global npm installation, cloning, or build step is needed. Restart OpenCode after configuring the plugin and credentials. This is a CLI-only integration; it does not require an MCP server.

To pin a specific release, use a versioned package entry such as `"package": "opencode-jira@0.1.0"`.

Open a session with the right sidebar visible. If there are no active sprints or no assigned issues, the section displays an appropriate empty state.

## Configuration

All options are per user; there is no hardcoded Jira tenant or board.

| Option | Default | Description |
| --- | --- | --- |
| `boardUrl` | `JIRA_BOARD_URL` | Full board URL; extracts the site and board ID. Supports `/boards/173` and `?rapidView=173`. |
| `site` | `JIRA_SITE` | Alternative HTTPS `*.atlassian.net` site URL when not using `boardUrl`. |
| `boardId` | `JIRA_BOARD_ID` | Alternative board ID when not using `boardUrl`. |
| `cloudId` | `JIRA_CLOUD_ID`, then discovery | Jira Cloud UUID for scoped-token requests. |
| `emailEnv` | `JIRA_EMAIL` | Name of the environment variable holding your Atlassian email. |
| `tokenEnv` | `JIRA_API_TOKEN` | Name of the environment variable holding your scoped API token. |
| `refreshSeconds` | `120` | Poll interval, 30–86400 seconds. Rate-limit responses may delay it further. |
| `maxHeight` | `12` | Maximum ticket-list height in terminal rows, 3–40. |

`boardUrl` takes precedence over `site` / `boardId`. Options take precedence over environment values. Multiple accounts can use custom `emailEnv` / `tokenEnv` names. All active sprint pages and ticket pages are fetched; tickets retain Jira's rank order within each status group. Tickets completed in the active sprint are included if still assigned to you; expand **Done** to see them. The plugin fetches `summary`, `status`, and `issuetype` and requires no extra scopes for issue types or grouping.

### Troubleshooting

- **Authentication failed:** check the token's expiry and that `JIRA_EMAIL` belongs to the account that created it.
- **Access denied:** check the three scopes above and your Jira board/issue permissions.
- **Cloud ID discovery fails:** visit `https://<your-site>/_edge/tenant_info` and set its `cloudId` in plugin options.
- **No sidebar:** expand your terminal or show the sidebar through OpenCode's settings.
- **Clicks do nothing:** enable `mouse` in CLI settings and configure a default browser. Linux requires `xdg-open`.
- **Kanban board:** use a Scrum board; Kanban boards do not have sprints.

The plugin does not change OpenCode configuration or store credentials or tickets on disk. It does not create or modify Jira issues. Browser launching uses argument arrays without a shell and only permits HTTPS Jira Cloud ticket URLs.

## Development

```sh
git clone https://github.com/shreyanshrana/opencode-jira.git
cd opencode-jira
npm ci
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

`npm ci` builds the checkout automatically. To test local changes, replace `"package": "opencode-jira"` in your CLI configuration with the absolute checkout path, such as `"package": "/absolute/path/to/opencode-jira"`. Run `npm run build` after changing source and restart OpenCode. To update a checkout, run `git pull --ff-only` and `npm ci`.

Babel compiles TypeScript and Solid JSX without bundling OpenCode's UI dependencies. Published packages contain JavaScript: OpenCode's TSX transformer excludes `node_modules`. `npm pack` runs the build and checks automatically. OpenTUI's native renderer runs inside OpenCode, not the Node-based unit tests. The host provides the UI peer dependencies. Node 22.18+ is required for the development tests.

OpenTUI 0.6.7 declares a Node 26.4+ / Bun 1.3.14+ engine requirement, so installing development dependencies on an older Node may warn even though the non-UI tests run there. The development dependency tree overrides `seroval` to a patched version. This override does not change OpenCode's bundled runtime; keep your OpenCode installation updated.

`npm pack` produces an installable `opencode-jira-<version>.tgz` containing compiled JavaScript and documentation, not source credentials or development dependencies. Publishing a GitHub release triggers the npm publishing workflow; its tag must match `v<version>` from `package.json`. No credentials are included in the package.

## License

[MIT](LICENSE)
