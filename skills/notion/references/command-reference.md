# Command Reference

Complete reference for ncli commands used by the Notion skill.

## Global conventions

Place global flags before the command group when possible:

```bash
ncli [--profile <name>] [--json] [--raw] <command> ...
```

| Flag | Purpose |
|---|---|
| `-p, --profile <name>` | Use the specified local profile for this command |
| `--json` | Return structured, machine-readable JSON |
| `--raw` | Return the unprocessed command response |
| `--verbose` | Enable verbose output |
| `--no-color` | Disable color output |

Profile selection follows this order:

1. `--profile <name>`
2. `NCLI_PROFILE`
3. the active profile selected by `ncli profile use`
4. `default`

An explicitly selected profile that does not exist is an error. ncli does not silently use another profile.

Keep one profile throughout a multi-command workflow. IDs returned from one workspace profile should not be passed to commands running under another profile.

## profile

Profile commands manage local authentication contexts. They do not contact Notion unless a later authentication or API command is run.

### profile add

```bash
ncli profile add <name> [--label <label>] [--use] [--if-not-exists]
```

| Argument or option | Purpose |
|---|---|
| `<name>` | Lowercase, portable profile name |
| `--label <label>` | Human-readable display label |
| `--use` | Make the profile active |
| `--if-not-exists` | Succeed without overwriting an existing profile |

`profile add` creates local storage only. Authenticate separately with `ncli --profile <name> login` and, when needed, `ncli --profile <name> rest login`.

### profile list

```bash
ncli profile list [--json]
```

Lists profiles without contacting Notion. Output includes the active profile, profile names and labels, and local MCP/REST authentication status. Workspace fields may be `null`. The command never returns token values.

### profile show

```bash
ncli profile show [name] [--json]
```

Shows one profile without revealing credentials. When `name` is omitted, ncli resolves the profile through the normal selection order.

### profile use

```bash
ncli profile use <name>
```

Sets the active profile for later commands. This does not authenticate the profile.

### profile delete

```bash
ncli profile delete <name> [--switch-to <name>] [--force]
ncli profile remove <name> [--switch-to <name>] [--force]
```

Deleting a profile removes local metadata, MCP OAuth credentials, and the saved REST token. It does not revoke OAuth access or invalidate an integration token in Notion.

- Use `--switch-to <name>` when deleting the active profile while another profile remains.
- Use `--force` in JSON or non-interactive mode.

## login, logout, and whoami

These commands operate on the selected profile.

```bash
ncli --profile work login [--headless] [--auth-timeout <seconds>]
ncli --profile work whoami [--json]
ncli --profile work logout
```

| Option | Purpose |
|---|---|
| `--headless` | Do not open a browser or HTTP listener; display the authorization URL and read the complete callback URL from hidden interactive TTY input |
| `--auth-timeout <seconds>` | Set the authorization wait to a whole number from 1 through 600 seconds |

Browser login waits 120 seconds by default. Headless login waits 600 seconds by default.

For headless login:

1. Open the displayed authorization URL in a browser on this or another computer.
2. Complete Notion authorization.
3. If the browser shows a connection error at a `127.0.0.1` URL, copy the complete address-bar URL.
4. Paste the URL only at the hidden `Callback URL` prompt.
5. Run `ncli --profile work whoami --json` to verify the MCP identity.

Never place the complete callback URL or authorization code in an answer, command argument, pipe, issue, or log. Headless login is interactive Authorization Code Flow + PKCE, not Device Code Flow or unattended authentication.

- `whoami` returns the current Notion user for the selected MCP profile.
- `logout` removes locally stored credentials from the selected profile.

REST authentication is managed separately through `rest login` and `rest logout`.

## search

```bash
ncli --profile work search "<query>" [--json] [--raw]
```

Search pages and databases in the selected workspace.

**Output example:**

```json
{
  "results": [
    {
      "id": "abc123-...",
      "title": "Weekly Review",
      "type": "page",
      "highlight": "...",
      "timestamp": "2026-03-15T..."
    }
  ],
  "type": "workspace_search"
}
```

## fetch

```bash
ncli --profile work fetch <url-or-id> [--json] [--raw]
```

Get page or database content. The argument may be a Notion URL or UUID.

**Output example for a page:**

```json
{
  "metadata": { "type": "page" },
  "title": "Weekly Review",
  "url": "https://www.notion.so/abc123...",
  "text": "<page url=\"...\">...<content>\n# Agenda\n- Status update\n</content>\n</page>"
}
```

When fetching a database, the `text` field may contain:

- `<database url="...">`: `database_id`
- `<data-source url="collection://...">`: `data_source_id`
- view URLs, when views exist

## page create

```bash
ncli --profile work page create --title "Title" --parent <id> \
  [--prop "Key=Value"...] [--body "content"] [--data '{json}']
```

| Option | Purpose |
|---|---|
| `--title` | Page title |
| `--parent` | Parent page ID, or `collection://<data-source-id>` for a database |
| `--prop "Key=Value"` | Page property; may be repeated |
| `--body "text"` | Body content; use `--body -` for standard input |
| `--data` | Direct JSON input that overrides the other command-specific flags |

**Parent resolution:**

- `collection://xxx` becomes `{ data_source_id: "xxx", type: "data_source_id" }`
- any other value becomes `{ page_id: "xxx", type: "page_id" }`

**Output example:**

```json
{
  "pages": [
    {
      "id": "new-page-id",
      "url": "https://www.notion.so/...",
      "properties": { "title": "..." }
    }
  ]
}
```

## page update

```bash
# Update properties
ncli --profile work page update <page-id> --prop "Key=Value" [--title "New Title"]

# Replace content
ncli --profile work page update <page-id> --body "# New content"
```

Do not combine `--prop` or `--title` with `--body`; they map to separate MCP operations.

- `--prop` and `--title` use `update_properties`
- `--body` uses `replace_content`

## page move

```bash
ncli --profile work page move <id...> --to <parent-id>
```

Move one or more pages to another parent.

**Destination resolution:**

- `collection://xxx`: data source
- `workspace`: workspace top level
- any other value: page

## page duplicate

```bash
ncli --profile work page duplicate <page-id>
```

Duplicate a page in the selected workspace.

## db create

```bash
# Use --prop shorthand
ncli --profile work db create --title "Tasks" --parent <page-id> \
  --prop "Name:title" \
  --prop "Status:select=Open,Done" \
  --prop "Priority:select=High,Medium,Low"

# Use a SQL-like schema
ncli --profile work db create \
  --schema 'CREATE TABLE "Tasks" ("Name" TITLE, "Status" SELECT)' \
  --parent <page-id>
```

`--prop` uses the format `"ColumnName:type=options"`.

| Type | Example |
|---|---|
| `title` | `"Name:title"` |
| `rich_text` | `"Description:rich_text"` |
| `select` | `"Status:select=Open,Done"` |
| `multi_select` | `"Tags:multi_select=Bug,Feature"` |
| `number` | `"Score:number"` |
| `date` | `"Due:date"` |
| `checkbox` | `"Done:checkbox"` |
| `url` | `"Link:url"` |
| `email` | `"Contact:email"` |
| `phone_number` | `"Phone:phone_number"` |

**Output example:**

```text
Created database: <database url="https://..."><data-source url="collection://ds-xxx">...</data-source></database>
```

Extract both `database_id` and `data_source_id` from the response before continuing.

## db update

```bash
ncli --profile work db update <data-source-id> \
  --title "New Title" \
  --statements 'ADD COLUMN "Priority" SELECT'
```

This command requires a `data_source_id`. Obtain it with `fetch <database-id>`.

## db query

```bash
ncli --profile work db query "<view-url>"
```

A database URL or ID is not sufficient. Use a view URL returned by `fetch` or `view create`.

**Output example:**

```json
{
  "results": [
    {
      "Status": "Open",
      "Name": "Task 1",
      "url": "https://www.notion.so/..."
    }
  ],
  "has_more": false
}
```

## view create and view update

```bash
# Create a view; both IDs are required
ncli --profile work view create --data '{"database_id":"<database-id>","data_source_id":"collection://<data-source-id>","type":"table","name":"All"}'

# Update a view
ncli --profile work view update --data '{"view_id":"<view-id>","name":"Renamed"}'
```

Use `--data` for the nested view payload. Supported view types include `table`, `board`, `list`, `calendar`, `gallery`, and `timeline`.

## comment create and comment list

```bash
ncli --profile work comment create <page-id> --body "Comment text"
ncli --profile work comment list <page-id> [--include-resolved]
```

## user list and team list

```bash
ncli --profile work user list [--query "alice"]
ncli --profile work team list [--query "engineering"]
```

## meeting-notes query

```bash
ncli --profile work meeting-notes query [--data '{"filter":{...}}']
```

The filter has a nested structure; use `--data` for non-trivial queries.

## api

```bash
ncli --profile work api <tool-name> '{"key":"value"}'
echo '{"query":"test"}' | ncli --profile work api notion-search
```

Use this escape hatch for MCP tools not covered by a dedicated command or for arguments that require direct JSON control.

## rest

REST commands use the integration token stored in the selected profile unless `NOTION_API_KEY` is set. The environment variable has higher priority.

```bash
# Authentication for the selected profile
ncli --profile work rest login
echo "ntn_..." | ncli --profile work rest login
ncli --profile work rest logout

# Confirm which integration is active
ncli --profile work rest GET /users/me
```

```bash
# API calls
ncli --profile work rest GET /pages/<page-id>
ncli --profile work rest POST /search '{"query":"test"}'
ncli --profile work rest PATCH /databases/<database-id> '{"title":[{"text":{"content":"New Title"}}]}'
ncli --profile work rest DELETE /blocks/<block-id>
echo '{"query":"test"}' | ncli --profile work rest POST /search
```

**Output example:**

```json
{
  "object": "user",
  "id": "abc123-...",
  "type": "person",
  "name": "Alice",
  "avatar_url": "https://..."
}
```

The integration must have access to each target page.

## file upload

File upload requires REST authentication. Uploading the file and attaching it to a page are separate operations.

```bash
ncli --profile work file upload <file-path> [--name <display-name>]
```

| Argument or option | Purpose |
|---|---|
| `<file-path>` | Local path to upload |
| `--name` | Optional display name in Notion |

**Examples:**

```bash
ncli --profile work file upload ./screenshot.png
ncli --profile work file upload ./report.pdf --name "Q1 Report"
```

The command returns a `file_upload_id` and prints an attachment example.

```bash
# 1. Upload
ncli --profile work file upload ./image.png
# Expected: file_upload_id in the response

# 2. Confirm the target page or find a block position
ncli --profile work fetch <page-id> --json
# Alternative: ncli --profile work rest GET /blocks/<page-id>/children

# 3a. Append to the page
ncli --profile work rest PATCH /blocks/<page-id>/children '{"children":[{"type":"file","file":{"type":"file_upload","file_upload":{"id":"<file-upload-id>"},"name":"image.png"}}]}'

# 3b. Insert after a specific block
ncli --profile work rest PATCH /blocks/<page-id>/children '{"position":{"type":"after_block","after_block":{"id":"<block-id>"}},"children":[{"type":"file","file":{"type":"file_upload","file_upload":{"id":"<file-upload-id>"},"name":"image.png"}}]}'
```

## Error patterns and recovery

| Situation | Action |
|---|---|
| Profile does not exist | Run `ncli profile list --json`, correct the name, or create the profile |
| Resource exists in one step but not the next | Confirm that every command used the same `--profile` value |
| REST command reaches the wrong workspace | Check whether `NOTION_API_KEY` overrides the profile token; verify with `/users/me` |
| Database URL used with `db query` | Fetch or create a view, then use its view URL |
| Database ID used as the parent for `page create` | Fetch the database and use `collection://<data-source-id>` |
| `data_source_id` is required | Run `fetch <database-id>` and extract `collection://...` |
| `rich_text` is required | Use `--body` for the comment content |
| MCP tool is not found | Check `ncli --help`; use `api` only when a direct tool call is required |
| JSON parsing fails | Validate the JSON passed to `--data` or the REST body |
| `--prop` and `--body` are combined | Split the property update and content replacement into separate commands |
| REST authentication fails | Run `rest login` for the selected profile or set `NOTION_API_KEY` deliberately |
| REST access is denied or returns 404 | Confirm the profile and grant the integration access to the page |
| Local file is not found | Correct the file path before retrying `file upload` |
