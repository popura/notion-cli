---
name: notion
description: >
  Operate one or more Notion workspaces through ncli (MCP + REST API).
  Covers profile selection, page search/create/update, database create/query, view management, comments, file upload, and direct REST API access.
  Use when the user asks to "Notion に書いて", "ページ作って", "タスク管理", "DB 作成",
  "Notion で検索", "議事録", "ファイルアップロード", "create a Notion page", "track tasks in Notion",
  "upload file to Notion", or perform another Notion workspace operation. Also triggers on the "notion" keyword.
compatibility: Requires ncli 0.4.0 or later and the selected profile authenticated (ncli login for MCP, ncli rest login for REST API). Claude Code only.
metadata:
  author: sakasegawa
  version: 2.2.0
---

# Notion CLI Skill

Operate Notion workspaces through ncli. ncli has two authentication backends:

- **MCP OAuth** for search, pages, databases, views, comments, users, teams, and meeting notes
- **REST integration tokens** for file upload, block operations, and direct REST API calls

A local ncli profile contains one MCP OAuth context and one REST token. These credentials may point to different Notion workspaces.

## Select the profile first

Before a multi-step workflow, determine which profile represents the target workspace.

```bash
ncli profile list --json
```

Apply these rules:

1. If the user names a profile, use `ncli --profile <name> ...` on every command.
2. If the user names a workspace but not a profile, match it against the profile name or label shown by `profile list` or `profile show`.
3. If several profiles are plausible, do not guess before a write operation. Ask which profile to use.
4. Keep every ID-producing and ID-consuming command in the same profile. Page IDs, database IDs, data-source IDs, and view URLs should not be threaded across profiles.
5. Prefer an explicit `--profile` flag in agent traces. `NCLI_PROFILE` is available, but an explicit flag makes the selected workspace auditable.

Profile selection follows this order:

```text
--profile <name>
NCLI_PROFILE
active profile selected by ncli profile use
default
```

An explicitly selected profile that does not exist is an error. ncli does not silently fall back to another profile.

## Prerequisites

Create a profile only when the requested workspace does not already have one.

```bash
# Create a profile without starting authentication
ncli profile add work --label "Company" --use

# MCP authentication for most commands
ncli --profile work login
ncli --profile work whoami

# MCP authentication when the host cannot launch a browser or use a loopback listener
ncli --profile work login --headless
ncli --profile work whoami --json

# REST authentication for ncli rest and ncli file
ncli --profile work rest login
ncli --profile work rest GET /users/me
```

The REST integration must have access to the target pages. In Notion, open the integration settings, select the integration, and add the required pages under **Content access**.

`NOTION_API_KEY` overrides the REST token stored in the selected profile. Check that environment variable when a REST command reaches an unexpected workspace.

## Authenticate safely in headless environments

Use `ncli --profile <name> login --headless` only in an interactive terminal. The command prints an authorization URL to stderr, then reads the complete `127.0.0.1` callback URL through hidden TTY input.

Apply these security rules:

1. Do not ask the user to paste an authorization code or complete callback URL into the conversation.
2. Do not include either value in an answer, tool argument, shell command, issue, or log.
3. Do not pipe a callback URL to `search`, `fetch`, `api`, or another normal command. Only the hidden prompt owned by `login --headless` accepts it.
4. If the agent execution environment cannot provide an interactive TTY, ask the user to run the headless login command directly in their terminal. Resume only after the command finishes.
5. Run `ncli --profile <name> whoami --json` after login and confirm that the returned MCP identity belongs to the intended workspace.

Headless login still requires a person and a browser, which may run on another computer. It is not Device Code Flow and is not suitable for unattended authentication.

## Core pattern: Search → Fetch → Act

Use one profile throughout the workflow.

1. **Search:** `ncli --profile <name> search "<query>" --json`
2. **Fetch:** `ncli --profile <name> fetch <id> --json`
3. **Act:** use the extracted IDs with the same `--profile <name>`

See `references/id-patterns.md` for ID extraction and threading rules.

## Profile commands

| Command | Purpose |
|---|---|
| `ncli profile add <name>` | Create local profile storage without authenticating |
| `ncli profile list --json` | List local profiles and non-secret connection metadata |
| `ncli profile show [name] --json` | Inspect one profile without revealing credentials |
| `ncli profile use <name>` | Set the default profile for later commands |
| `ncli profile delete <name>` | Delete the profile and locally stored credentials |

`profile delete` does not revoke OAuth access or invalidate an integration token in Notion. In JSON or non-interactive mode, deletion requires `--force`. Deleting the active profile while another profile remains requires `--switch-to <name>`.

## Key commands

The examples below use the profile name `work`. Replace it with the selected profile.

### MCP commands

| Command | Purpose |
|---|---|
| `ncli --profile work search "<query>"` | Search pages and databases |
| `ncli --profile work fetch <url-or-id>` | Get page or database content |
| `ncli --profile work page create --title "T" --parent <id>` | Create a page |
| `ncli --profile work page update <id> --prop "Key=Value"` | Update properties |
| `ncli --profile work page update <id> --body "content"` | Replace content |
| `ncli --profile work page move <id> --to <parent-id>` | Move a page |
| `ncli --profile work page duplicate <id>` | Duplicate a page |
| `ncli --profile work db create --title "T" --parent <id> --prop "Name:title"` | Create a database |
| `ncli --profile work db query "<view-url>"` | Query a database view |
| `ncli --profile work comment create <page-id> --body "text"` | Add a comment |
| `ncli --profile work api <tool> '{json}'` | Call an MCP tool directly |

### REST API commands

| Command | Purpose |
|---|---|
| `ncli --profile work file upload <file-path>` | Upload a file and return a `file_upload_id` |
| `ncli --profile work rest GET <path>` | Send a GET request |
| `ncli --profile work rest POST <path> '{json}'` | Send a POST request |
| `ncli --profile work rest PATCH <path> '{json}'` | Send a PATCH request |
| `ncli --profile work rest DELETE <path>` | Send a DELETE request |

See `references/command-reference.md` for complete arguments, outputs, and constraints.

### Global flags

- `-p, --profile <name>`: use the specified profile for this command
- `--json`: output structured JSON; use this for programmatic access
- `--raw`: output the unprocessed command response
- `--verbose`: enable verbose output
- `--no-color`: disable color output

`--data '{json}'` is a command-specific escape hatch for commands that support direct JSON input. It is not a global flag.

## Common workflows

### 1. Search, fetch, and update

```bash
ncli --profile work search "project plan" --json
ncli --profile work fetch <page-id> --json
ncli --profile work page update <page-id> --prop "Status=Done"
```

Expected progression:

- `search` returns candidate resource IDs.
- `fetch` confirms the target and returns its current content or schema.
- `page update` modifies the confirmed resource in the same profile.

### 2. Database lifecycle

```bash
# Create the database, then extract database_id and data_source_id
ncli --profile work db create --title "Tasks" --parent <page-id> \
  --prop "Name:title" --prop "Status:select=Open,Done"

# Create a view with both IDs
ncli --profile work view create --data '{"database_id":"<database-id>","data_source_id":"collection://<data-source-id>","type":"table","name":"All"}'

# Add an entry with data_source_id as the parent
ncli --profile work page create --parent collection://<data-source-id> \
  --title "Task 1" --prop "Status=Open"

# Query with the returned view URL
ncli --profile work db query "<view-url>"
```

### 3. File upload

```bash
# Upload the file and capture file_upload_id
ncli --profile work file upload ./screenshot.png

# Confirm the target page or find a specific block position
ncli --profile work fetch <page-id> --json
# Alternative: ncli --profile work rest GET /blocks/<page-id>/children

# Append the uploaded file to the page
ncli --profile work rest PATCH /blocks/<page-id>/children '{"children":[{"type":"file","file":{"type":"file_upload","file_upload":{"id":"<file-upload-id>"},"name":"screenshot.png"}}]}'
```

To insert after a specific block, include a `position.after_block.id` value in the PATCH body. The upload command prints an attachment example.

### 4. Direct REST API access

```bash
ncli --profile work rest GET /users/me
ncli --profile work rest GET /pages/<page-id>
ncli --profile work rest POST /search '{"query":"x"}'
ncli --profile work rest PATCH /blocks/<id>/children '{"children":[...]}'
```

## Important constraints

1. **Keep one profile throughout a workflow.** An ID found under one profile may not exist under another.
2. **`page update` separates properties from content.** Do not combine `--prop` or `--title` with `--body`.
3. **`db query` requires a view URL.** Fetch the database first or create a view.
4. **`view create` requires both `database_id` and `data_source_id`.** Fetch the database to obtain both values.
5. **Database page parents use the `collection://` prefix.** Pass `--parent collection://<data-source-id>`.
6. **File upload and attachment are separate operations.** Upload first, then attach through a REST PATCH request.
7. **MCP and REST authentication are separate.** Authenticate both backends in the selected profile when the workflow uses both.
8. **REST access is page-specific.** The integration must have access to the target page.
9. **`NOTION_API_KEY` overrides the selected profile's REST token.** Treat this environment variable as an explicit override.
10. **Profile deletion is local.** It does not revoke remote authorization.
11. **Errors include recovery hints.** Follow the hint before inventing a different command shape.
12. **Headless OAuth callback data stays in the terminal.** Never reproduce the callback URL or authorization code in agent output.
13. **Normal commands do not accept OAuth callbacks.** Do not redirect or pipe callback data into them.

## Troubleshooting

### Profile was not found

```text
Error: Profile "work" was not found
```

Cause: the name supplied through `--profile`, `NCLI_PROFILE`, or the profile configuration does not exist.

Fix: run `ncli profile list --json`, correct the name, or create it with `ncli profile add work`.

### A resource ID works in one command but not the next

Cause: the commands may have used different profiles, or the ID belongs to another workspace.

Fix: repeat `search` and `fetch` with the intended profile, and use the same explicit `--profile` value for every later command.

### MCP authentication failed

Cause: the selected profile has no valid MCP OAuth credentials.

Fix in a desktop environment:

```bash
ncli --profile work login
ncli --profile work whoami --json
```

Fix in an interactive SSH, container, or sandbox environment that cannot launch a browser or use a loopback listener:

```bash
ncli --profile work login --headless
ncli --profile work whoami --json
```

Do not copy the callback URL or authorization code into the agent conversation.

### REST API token is missing

```text
Error: No REST API token configured for the selected profile
  Hint: Set NOTION_API_KEY env var, or run "ncli rest login" for the selected profile
```

Cause: neither `NOTION_API_KEY` nor a saved REST token is available.

Fix: run `ncli --profile work rest login`, or set `NOTION_API_KEY` deliberately.

### REST command reaches an unexpected workspace

Cause: `NOTION_API_KEY` overrides the token stored in the selected profile, or the profile's MCP and REST credentials point to different workspaces.

Fix: inspect the environment and run `ncli --profile work rest GET /users/me` to confirm the integration identity.

### REST search returns no results

```text
Note: No results found. If you expected results, ensure your integration has access to pages.
```

Cause: the selected integration cannot access the expected pages.

Fix: add the pages to the integration's **Content access**, then repeat the request.

### REST page access returns 404

```text
Error: REST API resource not found
  Hint: The integration may not have access to this page.
```

Cause: the integration does not have access to the page, the page belongs to another workspace, or the wrong profile was selected.

Fix: confirm the profile, confirm `/users/me`, and grant the integration access to the page.

### File upload succeeds but attachment fails

Cause: uploading the bytes and modifying the target page use different REST operations. The integration may be allowed to upload but not modify the target page.

Fix: grant the selected profile's integration access to the page, then repeat the PATCH request with the returned `file_upload_id`.
