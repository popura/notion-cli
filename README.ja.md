# ncli

[![npm version](https://img.shields.io/npm/v/@sakasegawa/ncli)](https://www.npmjs.com/package/@sakasegawa/ncli)
[![license](https://img.shields.io/npm/l/@sakasegawa/ncli)](./LICENSE)
[![node](https://img.shields.io/node/v/@sakasegawa/ncli)](https://nodejs.org/)

> **免責事項:** ncli は非公式のコミュニティ製ツールです。Notion Labs, Inc. による開発、推奨、サポートは受けていません。

**[English](./README.md)**

ncli は、Notion MCP と Notion REST API を通じて、ターミナルから Notion を読み書きするためのコマンドラインインターフェースです。

人間と、Claude Code や Codex などのコーディングエージェントの両方を対象としています。機械可読な出力が必要な場合は `--json` を使用してください。エラーには、問題の内容、原因、復旧方法のヒントが含まれます。

## 特徴

- 検索、ページ、データベース、ビュー、コメント、ユーザー、チーム、ミーティングノートなどの主要なワークスペース操作
- 複数の Notion アカウントまたはワークスペースを分離するローカルプロファイル
- `ncli rest` による REST API への直接アクセス
- `ncli file upload` によるファイルアップロード
- MCP コマンドと REST API コマンドで分離された認証情報
- MCP コマンド向けの、ブラウザを使用する OAuth 2.0 + PKCE 認証
- `NOTION_API_KEY` または `ncli rest login` を使用するインテグレーショントークン認証
- `--json` と構造化されたエラーヒントによるエージェント向け出力
- `ncli api <tool> [json]` による MCP ツールの直接呼び出し
- Node.js 18 以降で動作する、バンドル済みの ESM 実行ファイル

## インストール

```bash
npm install -g @sakasegawa/ncli
```

## クイックスタート

プロファイルが未設定の状態で最初の MCP コマンドを実行すると、ローカルの `default` プロファイルが作成され、そのプロファイルが使用されます。

```bash
# 選択中のプロファイルをブラウザで認証
ncli login

# 認証された Notion ユーザーを確認
ncli whoami

# 検索して取得
ncli search "プロジェクト計画"
ncli fetch <id>

# ページを作成・更新
ncli page create --title "新しいページ" --parent <page-id>
ncli page update <id> --prop "Status=Done"

# データベースを作成してエントリを追加
ncli db create --title "タスク管理" --parent <page-id> \
  --prop "Name:title" --prop "Status:select=Open,Done"
ncli page create --parent collection://<data-source-id> \
  --title "タスク1" --prop "Status=Open"
```

### REST API

REST API コマンドは、MCP の OAuth 認証とは別の Notion インテグレーショントークンを使用します。

```bash
# 選択中のプロファイルにインテグレーショントークンを保存
ncli rest login

# インテグレーションの識別情報を確認
ncli rest GET /users/me

# ページを取得してファイルをアップロード
ncli rest GET /pages/<page-id>
ncli file upload ./image.png
```

REST API コマンドが読み取りまたは変更する各ページには、インテグレーションからのアクセス権が必要です。

## 複数プロファイル

1つのプロファイルには、ローカルの MCP OAuth コンテキスト、REST API 用インテグレーショントークン、秘密情報を含まない表示用メタデータが保存されます。同じプロファイル内の MCP 認証情報と REST 認証情報が、同じ Notion ワークスペースを指す必要はありません。

```bash
# 個人用プロファイルを作成して認証
ncli profile add personal --label "個人" --use
ncli login

# 仕事用プロファイルを作成して認証
ncli profile add work --label "会社"
ncli --profile work login
ncli --profile work rest login

# プロファイルを確認・使用
ncli profile list --json
ncli --profile work search "ロードマップ"
ncli profile use personal
```

プロファイルは次の優先順位で選択されます。

1. `--profile <name>`
2. `NCLI_PROFILE`
3. `ncli profile use` で選択したプロファイル
4. `default`

明示的に指定したプロファイルが存在しない場合はエラーになります。ncli が別のプロファイルへ暗黙に切り替わることはありません。

複数のコマンドにまたがるワークフローでは、すべての手順で同じプロファイルを使用してください。ページID、データベースID、データソースID、ビューURLを、取得元とは異なるワークスペースのプロファイルへ引き継がないでください。

`NOTION_API_KEY` は、選択中のプロファイルに保存された REST API トークンより優先されます。プロファイルを削除しても、削除されるのはローカルの認証情報だけです。Notion 側の OAuth 認可やインテグレーショントークンは失効しません。

保存形式、旧形式からの移行、削除時の動作については、[プロファイルの詳細](docs/profiles.md)を参照してください。

## コマンド一覧

| コマンド | 説明 |
|---|---|
| `ncli profile add <name>` | 認証を開始せずにローカルプロファイルを作成 |
| `ncli profile list` | Notion へ接続せずにローカルプロファイルを一覧表示 |
| `ncli profile show [name]` | 秘密情報を除いたプロファイル情報を表示 |
| `ncli profile use <name>` | 今後のコマンドで使用する既定プロファイルを設定 |
| `ncli profile delete <name>` | プロファイルとローカルに保存された認証情報を削除 |
| `ncli login` | 選択中のプロファイルを OAuth で認証 |
| `ncli logout` | 選択中のプロファイルからローカル認証情報を削除 |
| `ncli whoami` | 選択中のプロファイルで認証された Notion ユーザーを表示 |
| `ncli search <query>` | 選択中のワークスペースでページ、データベース、ユーザーを検索 |
| `ncli fetch <url-or-id>` | URL または ID でページ、データベース、データソースを取得 |
| `ncli page create` | `--title`、`--parent`、`--prop`、`--body` を使用してページを作成 |
| `ncli page update <id>` | ページのプロパティまたはコンテンツを更新 |
| `ncli page move <id...> --to <parent>` | ページを別の親へ移動 |
| `ncli page duplicate <id>` | ページを複製 |
| `ncli db create` | フラグまたは SQL 風のスキーマを使用してデータベースを作成 |
| `ncli db update <id>` | データベースのスキーマまたはメタデータを更新 |
| `ncli db query <view-url>` | データベースビューをクエリ |
| `ncli view create` | `--data` を使用してデータベースビューを作成 |
| `ncli view update` | `--data` を使用してデータベースビューを更新 |
| `ncli comment create <id>` | ページにコメントを追加 |
| `ncli comment list <id>` | ページのコメントを一覧表示 |
| `ncli user list` | ワークスペースのユーザーを一覧表示または検索 |
| `ncli team list` | ワークスペースのチームを一覧表示または検索 |
| `ncli meeting-notes query` | 条件を指定してミーティングノートをクエリ |
| `ncli rest login` | 選択中のプロファイルに REST API インテグレーショントークンを保存 |
| `ncli rest logout` | 選択中のプロファイルに保存された REST API トークンを削除 |
| `ncli rest <METHOD> <path> [json]` | Notion REST API エンドポイントを直接呼び出し |
| `ncli file upload <file-path>` | ファイルをアップロードして `file_upload_id` を返す |
| `ncli api <tool> [json]` | MCP ツールを直接呼び出し |

引数、使用例、制約の詳細は、`ncli <command> --help` で確認できます。

## よく使うワークフロー

### 検索、取得、更新

```bash
ncli search "プロジェクト計画"                # ページとデータベースを検索
ncli fetch <id>                              # コンテンツとメタデータを取得
ncli page update <id> --prop "Status=Done"   # プロパティを更新
```

複数のプロファイルを使用する場合は、ワークフロー全体でプロファイルを明示してください。

```bash
ncli --profile work search "プロジェクト計画"
ncli --profile work fetch <id>
ncli --profile work page update <id> --prop "Status=Done"
```

### データベースを作成してエントリを追加

```bash
# ページ配下にデータベースを作成
ncli db create --title "タスク管理" --parent <page-id> \
  --prop "Name:title" --prop "Status:select=Open,Done"

# レスポンスから database_id と data_source_id を取得
ncli page create --parent collection://<data-source-id> \
  --title "タスク1" --prop "Status=Open"

# ビューを作成してクエリ
ncli view create --data '{"database_id":"<database-id>","data_source_id":"collection://<data-source-id>","type":"table","name":"全件"}'
ncli db query "https://www.notion.so/<database-id>?v=<view-id>"
```

### 標準入力からコンテンツを渡す

```bash
echo "# 議事録" | ncli page create --title "ミーティングノート" --parent <id> --body -
```

## グローバルオプション

| オプション | 説明 |
|---|---|
| `-p, --profile <name>` | このコマンドで使用するプロファイルを指定 |
| `--json` | 構造化された機械可読な JSON を出力 |
| `--raw` | 未加工のコマンドレスポンスを出力 |
| `--verbose` | 詳細出力を有効化 |
| `--no-color` | カラー出力を無効化 |

## コーディングエージェント向け

コーディングエージェントから使用する場合は、次の方針を推奨します。

- 複数のプロファイルが存在する可能性がある場合は、操作前に `ncli profile list --json` を実行する。
- 複数手順のワークフローでは、IDを同じワークスペース内で扱うため、すべてのコマンドに `--profile <name>` を指定する。
- 機械可読な出力には `--json` を使用する。
- コマンド構造を変更する前に、エラーに含まれる復旧ヒントを確認する。
- `search` → `fetch` → `create`、`update`、または `query` の順で操作する。
- `data_source_id` またはビューURLが必要なデータベース操作の前に、`ncli fetch <database-id>` を実行する。

エラー例:

```text
Error: notion-create-pages failed
  Why: Could not find page with ID: abc123...
  Hint: If adding to a database, use --data with "parent":{"data_source_id":"<ds-id>",...}.
        Run "ncli fetch <db-id>" to get the data_source_id
```

## エスケープハッチ

CLI が直接対応していない操作や複雑な MCP 引数を使用する場合は、MCP ツールを直接呼び出せます。

```bash
ncli api notion-search '{"query":"test","page_size":3}'
echo '{"query":"test"}' | ncli api notion-search
```

## 動作要件

- Node.js 18 以降
- MCP OAuth コマンドで使用する Notion アカウント
- REST API およびファイルアップロードコマンドで使用する Notion インテグレーショントークン

## 法的情報

- [利用規約](TERMS.md)
- [プライバシーポリシー](PRIVACY.md)

## ライセンス

MIT
