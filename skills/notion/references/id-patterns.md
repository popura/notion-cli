# ID Discovery and Threading Patterns

Most ncli workflows extract IDs from one command and pass them to another. This reference describes the required ID formats and the profile context in which they are valid.

## Keep IDs in one profile

Notion resource IDs are meaningful only in the workspace that returned them. Select a profile before the first command and use the same profile for every later step.

```bash
ncli --profile work search "Sprint Tasks" --json
ncli --profile work fetch <database-id> --json
ncli --profile work page create --parent collection://<data-source-id> --title "Task 1"
```

Do not use an ID returned under `--profile personal` in a command running under `--profile work`. A profile mismatch commonly appears as a resource-not-found or access error.

`NCLI_PROFILE` can select a profile through the environment, but an explicit `--profile` value is easier to audit in agent-generated command sequences.

## ID types

| ID | Format | How to obtain | Used by |
|---|---|---|---|
| `page_id` | `abc123-def456` | `search` results or a `fetch` response | page update, move, duplicate, comments, and page parents |
| `database_id` | `abc123-def456` | `fetch <database>` or a `db create` response | view creation |
| `data_source_id` | `collection://ds-xxx` | `fetch <database>` or a `db create` response | database page parents, view creation, and database updates |
| `view_url` | `view://view-xxx` or a Notion URL containing `?v=` | `fetch <database>` or a `view create` response | database queries |

## Extract IDs from `fetch`

Fetch the database under the profile that will perform the later operations:

```bash
ncli --profile work fetch <database-id> --json
```

The response `text` field contains XML-like markup:

```text
<database url="https://www.notion.so/<database_id>">
  <data-source url="collection://<data_source_id>">
    ...
    <view name="All" url="view://<view_id>" type="table">
    ...
  </data-source>
</database>
```

Extract:

- `database_id` from the UUID in the `<database url="...">` attribute
- `data_source_id` from the `<data-source url="collection://...">` attribute
- `view_url` from the `<view ... url="view://...">` attribute, when a view exists

## Extract IDs from `db create`

```bash
ncli --profile work db create --title "Tasks" --parent <page-id> --prop "Name:title"
```

Example response text:

```text
Created database: <database url="https://www.notion.so/<database-id>">...<data-source url="collection://<data-source-id>">...</data-source></database>
```

Extract both values before continuing:

- `database_id` from the database URL
- `data_source_id` from `collection://...`

## Extract a view URL from `view create`

```bash
ncli --profile work view create --data '{"database_id":"<database-id>","data_source_id":"collection://<data-source-id>","type":"table","name":"All"}'
```

Example response text:

```text
Created view "All" (table) — view://<view-id>
```

Use the returned `view://<view-id>` string directly with `db query` under the same profile.

## Parent specification rules

When using `--parent` with `page create`, or `--to` with `page move`, ncli resolves the value as follows:

| Input | Resolution |
|---|---|
| `collection://ds-xxx` | `{ data_source_id: "ds-xxx", type: "data_source_id" }` for adding a page to a database |
| `abc123-def456` | `{ page_id: "abc123-def456", type: "page_id" }` for adding a page below another page |
| `workspace` | `{ type: "workspace" }` for moving a page to the workspace top level; valid only with `page move` |

## Complete workflow: Create and query a database

The following workflow keeps every command in the `work` profile.

```bash
# 1. Create the database
ncli --profile work db create --title "Sprint Tasks" --parent <page-id> \
  --prop "Name:title" \
  --prop "Status:select=Backlog,Todo,In Progress,Done" \
  --prop "Priority:select=High,Medium,Low" \
  --json

# 2. Extract values from the response
# database_id: "abc123..."
# data_source_id: "collection://ds-xxx"

# 3. Create a view with both IDs
ncli --profile work view create --data '{"database_id":"abc123...","data_source_id":"collection://ds-xxx","type":"table","name":"All Tasks"}' --json

# 4. Extract the returned view URL
# view_url: "view://view-yyy"

# 5. Add pages with data_source_id as the parent
ncli --profile work page create --parent collection://ds-xxx \
  --title "Task 1" --prop "Status=Todo" --prop "Priority=High"
ncli --profile work page create --parent collection://ds-xxx \
  --title "Task 2" --prop "Status=Backlog" --prop "Priority=Medium"

# 6. Query with the view URL
ncli --profile work db query "view://view-yyy" --json
```

## Common mistakes

| Mistake | Correction |
|---|---|
| Mixing profiles between `search`, `fetch`, and write commands | Repeat the workflow with one explicit `--profile` value |
| Using a database URL or ID with `db query` | Use a view URL returned by `fetch` or `view create` |
| Using a database ID as the parent for `page create` | Use `collection://<data-source-id>` |
| Omitting `database_id` from `view create` | Pass both `database_id` and `data_source_id` |
| Omitting the `collection://` prefix | Include the prefix when passing `data_source_id` as `--parent` |
