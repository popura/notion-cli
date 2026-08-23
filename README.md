# ncli

[![npm version](https://img.shields.io/npm/v/@sakasegawa/ncli)](https://www.npmjs.com/package/@sakasegawa/ncli)
[![license](https://img.shields.io/npm/l/@sakasegawa/ncli)](./LICENSE)
[![node](https://img.shields.io/node/v/@sakasegawa/ncli)](https://nodejs.org/)

> **Disclaimer:** ncli is an unofficial, community-built tool. It is not developed, endorsed, or supported by Notion Labs, Inc.

**[日本語](./README.ja.md)**

ncli is a command-line interface for reading and writing Notion through Notion MCP and the Notion REST API.

It is designed for both humans and coding agents such as Claude Code and Codex. Use `--json` for machine-readable output. Errors include a description, cause, and recovery hint.

## Features

- Common workspace operations: search, pages, databases, views, comments, users, teams, and meeting notes
- Multiple local profiles for separate Notion accounts or workspaces
- Direct REST API access through `ncli rest`
- File upload through `ncli file upload`
- Separate authentication for MCP commands and REST API commands
- Browser-based and interactive headless OAuth 2.0 with PKCE for MCP commands
- Integration-token authentication through `NOTION_API_KEY` or `ncli rest login`
- Agent-oriented output through `--json` and structured error hints
- Direct MCP tool access through `ncli api <tool> [json]`
- A bundled ESM executable for Node.js 18 or later

## Installation

```bash
npm install -g @sakasegawa/ncli
```

## Quick start

The first MCP command creates and uses a local `default` profile when no profile has been configured.

```bash
# Authenticate the selected profile in a browser
ncli login

# Confirm the authenticated Notion user
ncli whoami

# Search and fetch
ncli search "project plan"
ncli fetch <id>

# Create and update pages
ncli page create --title "New Page" --parent <page-id>
ncli page update <id> --prop "Status=Done"

# Create a database and add an entry
ncli db create --title "Tasks" --parent <page-id> \
  --prop "Name:title" --prop "Status:select=Open,Done"
ncli page create --parent collection://<data-source-id> \
  --title "Task 1" --prop "Status=Open"
```

### Headless OAuth login

Use interactive headless login on SSH hosts, in containers, or in sandboxes that cannot launch a local browser or accept an HTTP loopback listener. You need an interactive terminal (TTY) on the host running ncli and a web browser on any computer.

The callback URL contains a short-lived authorization code. Do not paste it into chat, issues, shell history, or logs. Do not pass it as a CLI argument or pipe it to a normal ncli command.

1. Confirm or create the target profile.

   ```bash
   ncli profile list --json
   ncli profile add work --if-not-exists
   ```

2. Start headless login. The default timeout is 600 seconds; `--auth-timeout` accepts 1–600 seconds.

   ```bash
   ncli --profile work login --headless
   ```

3. Open the displayed authorization URL in a browser on this or another computer, and complete Notion authorization.
4. The browser redirects to a `http://127.0.0.1:<port>/callback?...` URL. A connection-error page is expected when no listener exists. Copy the complete URL from the browser address bar.
5. Paste the complete URL at the hidden `Callback URL` prompt. ncli validates the redirect URI, state, expiry, and authorization code before token exchange.
6. Confirm the authenticated user and workspace.

   ```bash
   ncli --profile work whoami --json
   ```

With `--json`, instructions and the prompt remain on standard error, while the successful user result is written to standard output.

This flow is interactive Authorization Code Flow with Proof Key for Code Exchange (PKCE). It is not OAuth Device Authorization Grant (Device Code Flow), and it does not provide unattended or service-account authentication.

See [Authentication](docs/auth.md) for storage, refresh, cleanup, and security details.

### REST API

REST API commands use a Notion integration token, which is separate from MCP OAuth authentication.

```bash
# Save an integration token in the selected profile
ncli rest login

# Confirm the integration identity
ncli rest GET /users/me

# Read a page and upload a file
ncli rest GET /pages/<page-id>
ncli file upload ./image.png
```

The integration must have access to every page that the REST command reads or modifies.

## Multiple profiles

A profile stores one local MCP OAuth context, one local REST integration token, and non-secret display metadata. MCP and REST credentials in the same profile are not required to point to the same Notion workspace.

```bash
# Create and authenticate a personal profile
ncli profile add personal --label "Personal" --use
ncli login

# Create and authenticate a work profile
ncli profile add work --label "Company"
ncli --profile work login
ncli --profile work rest login

# Inspect and use profiles
ncli profile list --json
ncli --profile work search "roadmap"
ncli profile use personal
```

Profile selection follows this order:

1. `--profile <name>`
2. `NCLI_PROFILE`
3. the profile selected by `ncli profile use`
4. `default`

An explicitly selected profile that does not exist causes an error. ncli does not silently switch to another profile.

When a workflow spans multiple commands, use the same profile for every step. Page IDs, database IDs, data-source IDs, and view URLs should not be carried from one workspace profile into another.

`NOTION_API_KEY` has higher priority than the REST token saved in the selected profile. Deleting a profile removes local credentials only; it does not revoke OAuth access or invalidate an integration token in Notion.

See [Profiles](docs/profiles.md) for storage, migration, and deletion behavior.

## Commands

| Command | Description |
|---|---|
| `ncli profile add <name>` | Create a local profile without starting authentication |
| `ncli profile list` | List local profiles without contacting Notion |
| `ncli profile show [name]` | Show non-secret profile information |
| `ncli profile use <name>` | Set the default profile for future commands |
| `ncli profile delete <name>` | Delete a profile and its locally stored credentials |
| `ncli login` | Log in to the selected profile through browser OAuth |
| `ncli login --headless` | Log in through a remote browser and hidden callback URL input |
| `ncli logout` | Remove locally stored credentials from the selected profile |
| `ncli whoami` | Show the current Notion user for the selected profile |
| `ncli search <query>` | Search pages, databases, and users in the selected workspace |
| `ncli fetch <url-or-id>` | Retrieve a page, database, or data source by URL or ID |
| `ncli page create` | Create a page with `--title`, `--parent`, `--prop`, and `--body` |
| `ncli page update <id>` | Update page properties or content |
| `ncli page move <id...> --to <parent>` | Move pages to a new parent |
| `ncli page duplicate <id>` | Duplicate a page |
| `ncli db create` | Create a database with flags or a SQL-like schema |
| `ncli db update <id>` | Update database schema or metadata |
| `ncli db query <view-url>` | Query a database view |
| `ncli view create` | Create a database view through `--data` |
| `ncli view update` | Update a database view through `--data` |
| `ncli comment create <id>` | Add a comment to a page |
| `ncli comment list <id>` | List comments on a page |
| `ncli user list` | List or search workspace users |
| `ncli team list` | List or search workspace teams |
| `ncli meeting-notes query` | Query meeting notes with filters |
| `ncli rest login` | Save a REST API integration token in the selected profile |
| `ncli rest logout` | Remove the selected profile's saved REST API token |
| `ncli rest <METHOD> <path> [json]` | Call a Notion REST API endpoint directly |
| `ncli file upload <file-path>` | Upload a file and return a `file_upload_id` |
| `ncli api <tool> [json]` | Call an MCP tool directly |

Run `ncli <command> --help` for detailed arguments, examples, and constraints.

## Common workflows

### Search, fetch, and update

```bash
ncli search "Project Plan"                  # Find pages and databases
ncli fetch <id>                              # Read content and metadata
ncli page update <id> --prop "Status=Done"  # Update properties
```

With multiple profiles, keep the profile explicit throughout the workflow:

```bash
ncli --profile work search "Project Plan"
ncli --profile work fetch <id>
ncli --profile work page update <id> --prop "Status=Done"
```

### Create a database and add entries

```bash
# Create a database under a page
ncli db create --title "Tasks" --parent <page-id> \
  --prop "Name:title" --prop "Status:select=Open,Done"

# Extract database_id and data_source_id from the response
ncli page create --parent collection://<data-source-id> \
  --title "Task 1" --prop "Status=Open"

# Create a view and query it
ncli view create --data '{"database_id":"<database-id>","data_source_id":"collection://<data-source-id>","type":"table","name":"All"}'
ncli db query "https://www.notion.so/<database-id>?v=<view-id>"
```

### Pipe content from standard input

```bash
echo "# Meeting Notes" | ncli page create --title "Notes" --parent <id> --body -
```

## Global flags

| Flag | Description |
|---|---|
| `-p, --profile <name>` | Use the specified profile for this command |
| `--json` | Output structured, machine-readable JSON |
| `--raw` | Output the unprocessed command response |
| `--verbose` | Enable verbose output |
| `--no-color` | Disable color output |

## Agent usage

For coding-agent workflows:

- Run `ncli profile list --json` before operating when more than one profile may exist.
- Use `--profile <name>` on every command in a multi-step workflow so that IDs remain in one workspace context.
- In a headless interactive environment, run `ncli --profile <name> login --headless`.
- Never include an authorization code or complete callback URL in an answer, command argument, pipe, issue, or log.
- After authentication, run `ncli --profile <name> whoami --json` to verify the MCP identity.
- Use `--json` for machine-readable output.
- Follow the recovery hint in an error before changing command structure.
- Use the workflow `search` → `fetch` → `create`, `update`, or `query`.
- Run `ncli fetch <database-id>` before database operations that require a `data_source_id` or view URL.

Example error:

```text
Error: notion-create-pages failed
  Why: Could not find page with ID: abc123...
  Hint: If adding to a database, use --data with "parent":{"data_source_id":"<ds-id>",...}.
        Run "ncli fetch <db-id>" to get the data_source_id
```

## Escape hatch

For unsupported operations or complex MCP arguments, call a tool directly:

```bash
ncli api notion-search '{"query":"test","page_size":3}'
echo '{"query":"test"}' | ncli api notion-search
```

## Requirements

- Node.js 18 or later
- A Notion account for MCP OAuth commands
- A Notion integration token for REST API and file-upload commands

## Legal

- [Terms of Use](TERMS.md)
- [Privacy Policy](PRIVACY.md)

## License

MIT
