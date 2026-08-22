# Profiles

`ncli` can keep multiple independent Notion authentication contexts on one machine. A profile is a local container for MCP OAuth credentials, REST integration credentials, and non-secret display metadata. It is not assumed that MCP and REST point to the same Notion workspace.

## Quick start

```bash
ncli profile add personal --label "Personal" --use
ncli login

ncli profile add work --label "Company"
ncli --profile work login
ncli --profile work rest login

ncli profile list
ncli --profile work search "roadmap"
```

## Commands

```bash
ncli profile add <name> [--label <label>] [--use] [--if-not-exists]
ncli profile list
ncli profile show [name]
ncli profile use <name>
ncli profile delete <name> [--switch-to <name>] [--force]
```

`profile add` only creates local storage. Authentication is a separate operation so that a cancelled browser login does not make profile creation ambiguous.

Deleting a profile removes its local OAuth and REST credentials. It does not revoke the OAuth grant in Notion and does not invalidate a Notion integration token remotely.

## Selection order

Commands resolve a profile in this order:

1. `--profile <name>`
2. `NCLI_PROFILE`
3. the profile selected by `ncli profile use`
4. `default`

An explicitly selected profile that does not exist is an error. `ncli` never silently falls back to another workspace.

`NOTION_API_KEY` remains the highest-priority REST credential and overrides the token saved in the selected profile.

## Storage

The operating-system-specific ncli configuration directory contains:

```text
profiles.json
profiles/
  personal/
    profile.json
    tokens.json
    client.json
    auth-state.json
    rest-token.json
  work/
    profile.json
    tokens.json
    client.json
    auth-state.json
    rest-token.json
```

`profile.json` contains display metadata only. Secret values remain in their dedicated credential files. Profile names are lowercase, portable directory names; use `--label` for names containing spaces, uppercase letters, or non-ASCII characters.

## Migration

Existing single-profile files in the configuration root are migrated to `profiles/default/` on first use:

```text
tokens.json
client.json
auth-state.json
rest-token.json
```

Migration copies and verifies the new layout before deleting the legacy files. If legacy credentials conflict with an existing `default` profile, ncli stops without overwriting either copy.
