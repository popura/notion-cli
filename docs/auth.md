# Authentication

この文書は ncli 0.4.0 の認証動作を説明する。

Model Context Protocol（MCP）コマンドは OAuth 2.0 Authorization Code Flow + Proof Key for Code Exchange（PKCE）を使用する。REST API コマンドは Notion Integration Token を使用する。2つの認証先は独立しており、同じプロファイル内でも異なる Notion ワークスペースを指す可能性がある。

## 認証方式

MCP OAuth には2つの対話方式がある。TTY は、端末へ直接接続された対話型入出力を指す。

| 方式 | コマンド | ブラウザ起動 | HTTP listener | コールバック |
|---|---|---:|---:|---|
| ブラウザ | `ncli --profile work login` | ncli がローカルブラウザを開く | `127.0.0.1` で起動 | ブラウザから自動受信 |
| ヘッドレス | `ncli --profile work login --headless` | 不使用 | 不使用 | 完全な URL を非表示の TTY 入力で受信 |

ここで HTTP listener は、`127.0.0.1` だけで待ち受ける一時的な HTTP サーバーを指す。`--headless` は Device Code Flow ではなく、利用者がブラウザ操作と URL 貼り付けを行う対話型フローである。完全無人実行やサービスアカウント認証には使用できない。

## 通常のブラウザ認証

初回認証または再認証では、次の順序で処理する。

1. ncli は対象プロファイルを解決し、`client.json` に有効なループバックリダイレクト URI があれば、そのポートで listener の起動を試す。
2. 保存済みポートが他プロセスと競合している場合は、オペレーティングシステム（OS）が割り当てた別のポートで listener を起動し、古いクライアント登録を破棄する。
3. listener を起動した後、プロファイル専用の `state` と10分以内の有効期限を `auth-state.json` へ保存する。コールバック待機は、認可 URL を開く前に開始する。
4. MCP SDK が OAuth discovery、必要に応じた Dynamic Client Registration、PKCE verifier の生成を行う。ncli は verifier を同じ一時状態へ保存する。
5. ncli は SDK から受け取った認可 URL をローカルブラウザで開く。
6. listener は `http://127.0.0.1:<port>/callback` へのリダイレクトを受信し、リダイレクト URI、`state`、有効期限、`code` を検証する。
7. 検証済みコードだけを MCP SDK の `finishAuth()` へ渡す。SDK がコードをトークンへ交換し、ncli が `tokens.json` へ保存する。
8. ncli は一時認証状態と listener を削除し、新しい transport で MCP へ再接続する。

ブラウザ起動または listener 起動が失敗した場合、エラーは同じプロファイルを使用する `login --headless` コマンドを案内する。ヘッドレス方式はコールバックを TTY から受け取るため、listener は不要である。

## ヘッドレス認証

### 前提条件

- ncli を実行するホストに、非表示入力を利用できる対話型ターミナル（TTY）がある。
- 同じコンピューターまたは別のコンピューターで Notion の認可 URL を開ける。
- 対象プロファイルを `ncli profile list --json` で確認済みである。

stdin が TTY でない場合、ncli は URL を待たずに失敗する。パイプまたはファイルからコールバック URL を読み取る機能は提供しない。

### 手順

コールバック URL には短時間だけ有効な認可コードが含まれる。チャット、Issue、シェル履歴、ログへ貼り付けてはならない。CLI 引数として渡したり、通常の ncli コマンドへパイプしたりしてはならない。

1. ヘッドレスログインを開始する。

   ```bash
   ncli --profile work login --headless
   ```

   既定の待機時間は600秒である。`--auth-timeout <seconds>` には1～600秒を指定できる。

2. stderr に表示された認可 URL をブラウザで開き、Notion の認可を完了する。
3. ブラウザが `http://127.0.0.1:<port>/callback?...` へ移動したら、接続エラー画面が表示されても、アドレスバーから完全な URL をコピーする。
4. ターミナルの `Callback URL` プロンプトへ完全な URL を貼り付け、Enter を押す。入力中は端末エコーを無効化し、入力値を再表示しない。
5. 認証後に接続先を確認する。

   ```bash
   ncli --profile work whoami --json
   ```

`--json` を併用しても、認可 URL、手順、入力プロンプトは stderr へ出力する。認証成功後のユーザー情報だけを stdout へ JSON で出力する。コールバック URL、認可コード、アクセストークン、Refresh Token はどちらの出力にも含めない。

### リダイレクト URI の決定

ヘッドレス方式は listener から空きポートを取得できないため、次の順序で URI を選ぶ。

1. `client.json` に登録済みの有効な `http://127.0.0.1:<port>/callback` があれば再利用する。
2. 登録済み URI がなければ、動的・プライベートポート範囲（49152～65535）から暗号学的乱数でポートを選ぶ。
3. 選択した URI を Dynamic Client Registration の `redirect_uris` と一時認証状態へ保存する。

ブラウザを実行するコンピューター上でこのポートへ接続できる必要はない。ブラウザの接続失敗後にアドレスバーの URL を手動で戻すためである。

## 保存済みトークンと listener の遅延起動

通常コマンドは、保存済みトークンがある場合に listener やブラウザ interaction を作成せず、最初の MCP 接続を試す。

- アクセストークンが有効なら、そのまま接続する。
- アクセストークンが失効していて有効な Refresh Token があれば、MCP SDK が更新して再試行する。この経路でもブラウザと listener は使用しない。
- Refresh Token が `invalid_grant` で拒否された場合、ncli は保存済みトークンだけを削除し、選択された方式で再認証を開始する。

したがって、認証済みプロファイルの `whoami`、`search`、`fetch` などは `server.listen()` を必要としない。通常コマンドがコールバック URL の入力を暗黙に要求することもない。手動入力は明示的な `login --headless` だけで行う。

## `state` と PKCE

`state` と PKCE は異なる攻撃を防ぐ。

- `state` は認証試行ごとに32バイトの暗号学的乱数から生成する。コールバックが同じプロファイルの同じ認証試行に属することを確認し、古いタブや別プロファイルの URL を拒否する。
- PKCE verifier は MCP SDK が生成し、一時状態に保存する。認可コードを取得した第三者が verifier なしでトークン交換することを防ぐ。

コールバック URL は次の順序で検証する。

1. 入力長が8192の設定上限以内である。
2. スキームを含む完全な URL として解析できる。
3. スキーム、ホスト、ポート、パスが保留中セッションのリダイレクト URI と一致する。
4. ホストが厳密に `127.0.0.1` であり、userinfo とフラグメントを含まない。
5. `state` が1個だけ存在し、保存値と一致する。
6. 一時セッションが期限切れでない。
7. `code` と `error` が同時に存在しない。
8. `error` があれば認可拒否として扱う。
9. 空でない `code` が1個だけ存在する。

`state` 不一致、リダイレクト URI 不一致、期限切れ、認可拒否、入力タイムアウトは別の `CliError` として表示する。検証に失敗したコードを token endpoint へ送信しない。

## 一時認証状態とプロファイル

認証情報は OS ごとの ncli 設定ディレクトリにある `profiles/<name>/` へ保存する。

```text
profiles/
  work/
    profile.json
    client.json
    tokens.json
    auth-state.json
    rest-token.json
```

| ファイル | 内容 | 保持期間 |
|---|---|---|
| `client.json` | OAuth クライアント登録と `redirect_uris` | logout またはプロファイル削除まで |
| `tokens.json` | Access Token と Refresh Token | logout またはプロファイル削除まで |
| `auth-state.json` | `state`、PKCE verifier、リダイレクト URI、方式、作成日時、有効期限 | 認証試行の終了まで |
| `rest-token.json` | REST Integration Token | REST logout またはプロファイル削除まで |

`auth-state.json` の最大有効期間は10分である。成功、入力不正、認可拒否、タイムアウト、コード交換失敗のいずれでも、所有する一時状態を削除する。同じプロファイルで有効な一時状態が存在する場合、2つ目のログインは開始しない。期限切れ状態は新しいログイン開始時に削除する。

認証状態の作成と更新はアトミックに行う。Portable Operating System Interface（POSIX）互換ファイルシステムでは、`0o600`（所有者だけが読み書き可能）を設定する。別プロファイルの `auth-state.json`、`client.json`、`tokens.json` は読み書きしない。旧形式の `{"codeVerifier":"..."}` は未完了の古い状態として削除し、変換しない。

## 認可コードを CLI 引数にしない理由

認可コードや完全なコールバック URL を CLI 引数にすると、シェル履歴、プロセス一覧、ジョブログへ残る可能性がある。また、コードだけではリダイレクト URI と `state` を一体として検証できない。

ncli は完全な URL を非表示の TTY 入力から1回だけ読み、共通パーサーで検証する。環境変数や通常コマンドの stdin から認可コードを受け取らない。

## REST API 認証

REST API コマンド（`ncli rest`、`ncli file`）は MCP OAuth と別の Integration Token を使用する。

トークンは次の順序で解決する。

1. `NOTION_API_KEY` 環境変数
2. 選択中プロファイルの `rest-token.json`
3. 認証情報不足を示す `CliError`

`NOTION_API_KEY` は保存済みトークンより優先されるため、REST コマンドが想定外のワークスペースへ接続した場合は、環境変数と `ncli --profile work rest GET /users/me` を確認する。

| 項目 | MCP OAuth | REST API |
|---|---|---|
| 認証 | Authorization Code Flow + PKCE | Integration Token |
| 対話コマンド | `login` または `login --headless` | `rest login` |
| 自動更新 | Refresh Token が有効な場合に MCP SDK が実行 | なし |
| 接続先確認 | `whoami --json` | `rest GET /users/me` |
| 主な用途 | 検索、ページ、データベース、ビュー、コメント | REST API の直接呼び出し、ファイルアップロード |
