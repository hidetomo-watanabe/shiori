# ライブのしおり｜公開手順書

## 構成

| 役割 | 公開先 | URL |
| --- | --- | --- |
| 画面（HTML・JS・CSS） | GitHub Pages | https://shiori.whathides.co.jp |
| API（保存・更新・削除） | Cloudflare Workers | https://live-shiori-api.<アカウント名>.workers.dev |
| イベントの保存先 | Cloudflare R2 | バケット `live-shiori` |

- 利用者が開くのは `shiori.whathides.co.jp` だけ。APIのURLは画面の中から呼ばれるだけで、利用者には見えない。
- APIは `shiori.whathides.co.jp` からの呼び出しだけを受け付ける（`wrangler.toml` の `ALLOWED_ORIGINS`）。
- 費用：Cloudflare の無料プランの範囲（Workers 1日10万リクエスト、R2 保存10GB など）で運用できる想定。Workers は無料枠を超えても自動課金されず、超えた分がエラーになる。

## 事前に用意するもの

- GitHub アカウント（GitHub Pages の運用経験がある前提）
- Cloudflare アカウント（無料）
- Node.js 22 以上（手元のPC）
- `whathides.co.jp` の DNS を編集できる権限

> GitHub の無料プランでは、**非公開リポジトリで GitHub Pages を使えない**。リポジトリを公開にするか（コードに秘密情報は含まれない）、有料プランを使う。

## 手順

### 1. リポジトリを作成する

1. ZIP を展開した `live-table` フォルダを、GitHub の新しいリポジトリ（例：`live-shiori`）に push する。
2. `dist/` は `.gitignore` 済み。GitHub Actions がビルドするのでコミット不要。

```bash
cd live-table
git init && git add -A && git commit -m "初版"
git branch -M main
git remote add origin git@github.com:<ユーザー名>/live-shiori.git
git push -u origin main
```

※ この時点では Actions が「API_BASE を設定してください」で失敗する。手順4で設定する。

### 2. Cloudflare に R2 バケットを作る

1. Cloudflare ダッシュボード → **R2** を開き、R2 を有効にする（支払い方法の登録を求められる場合がある）。
2. バケットを作成する。名前は `live-shiori`（変える場合は `wrangler.toml` の `bucket_name` も合わせる）。

コマンドで作る場合：

```bash
npx wrangler@4 login
npx wrangler@4 r2 bucket create live-shiori
```

### 3. API を Cloudflare Workers に公開する

```bash
npx wrangler@4 login          # 初回のみ。ブラウザで Cloudflare にログイン
npm run deploy:api            # ビルドして API を公開
```

- 完了すると `https://live-shiori-api.<アカウント名>.workers.dev` が表示される。**このURLを控える。**
- 初回は workers.dev のサブドメイン名を決めるよう求められる場合がある。
- 動作確認（`{"error":"イベントが見つかりません…"}` が返ればOK）：

```bash
curl https://live-shiori-api.<アカウント名>.workers.dev/api/events/000000000000000000000000
```

任意：作成回数制限に使う秘密値を自分で設定する場合（未設定でも自動生成される）

```bash
npx wrangler@4 secret put RATE_LIMIT_SALT   # 長いランダム文字列を入力
```

### 4. GitHub Pages を設定する

リポジトリの **Settings** で次を設定する。

1. **Secrets and variables → Actions → Variables** に変数を追加
   - 名前：`API_BASE`
   - 値：手順3のURL（例：`https://live-shiori-api.xxxx.workers.dev`、末尾の `/` なし）
2. **Pages → Build and deployment → Source** を **GitHub Actions** にする。
3. **Pages → Custom domain** に `shiori.whathides.co.jp` を入力して保存する（ビルド成果物にも `CNAME` を含めている）。
4. 推奨：アカウントの **Settings → Pages → Verified domains** で `whathides.co.jp` を検証しておく（ドメイン乗っ取り対策）。

### 5. DNS を設定する

`whathides.co.jp` の DNS に次を追加する。

| 種別 | 名前 | 値 |
| --- | --- | --- |
| CNAME | `shiori` | `<GitHubユーザー名またはOrg名>.github.io` |

- 反映後、Pages の設定画面で **Enforce HTTPS** にチェックを入れる（証明書の発行に数分〜数十分かかる場合がある）。

### 6. 画面を公開する

- **Actions → Deploy to GitHub Pages → Run workflow** を実行する（以降は `main` への push で自動公開）。
- ワークフローはテスト → ビルド → 公開の順に実行される。テストが失敗した場合は公開されない。

### 7. 公開後の確認（受け入れ条件）

- [ ] https://shiori.whathides.co.jp を iPhone の Safari で開き、イベントを作成・保存できる
- [ ] 閲覧リンクを LINE で送り、LINE内ブラウザで読める
- [ ] 別の端末（未ログイン）で閲覧リンクを開ける。サービスロゴが表示され、編集操作は表示されない
- [ ] 編集して保存すると、閲覧側の再読み込みで反映される
- [ ] 編集リンクを別の端末で開いて編集できる。2つの端末で同時に保存すると競合パネルが出る
- [ ] 削除すると、閲覧リンク・編集リンクとも「見つかりません」になる
- [ ] Cloudflare ダッシュボード → Workers → `live-shiori-api` → **Triggers** に Cron（毎日 3:00 JST）が表示されている

## 日常の運用

| やりたいこと | 方法 |
| --- | --- |
| 画面を更新する | `public/` を修正して `main` に push（自動公開） |
| API を更新する | `worker/api.mjs` を修正して `npm run deploy:api` |
| テストする | `npm test` |
| API を呼べるドメインを増やす | `wrangler.toml` の `ALLOWED_ORIGINS` にカンマ区切りで追加して `npm run deploy:api` |
| 利用量・費用を確認する | Cloudflare ダッシュボード → Workers / R2 の Metrics |
| セトリの「曲を検索」で YouTube を出す | 下の「YouTube 検索（任意）」 |

- GitHub Pages は配信ファイルを最大10分程度キャッシュする。ビルド時に `app.js?v=…` のように版番号を付けているため、新旧のファイルが混ざることはない。
- APIの変更で画面側の対応が必要な場合は、**API → 画面の順**に公開する。

## YouTube 検索（任意）

セトリの「曲を検索」で、YouTube の動画候補を出して参考URLに入れられるようにする。未設定のあいだは「準備中」と表示し、YouTube の検索結果ページへのリンクだけを出す。

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作り、**YouTube Data API v3** を有効にする。
2. **認証情報 → APIキーを作成**。キーの制限で「API の制限」を YouTube Data API v3 のみにする（アプリケーションの制限は「なし」。Worker から呼ぶため）。
3. キーを Worker の秘密値に登録する（画面やリポジトリには置かない）。

```sh
npx wrangler@4 secret put YOUTUBE_API_KEY
```

- 無料枠は1日10,000ユニット（検索1回100ユニット＝約100回）。超えるとその日は「上限」と表示され、翌日（太平洋時間0時）に戻る。課金を有効にしない限り費用はかからない。
- 同じ検索語の結果は7日間 R2 に保管して使い回す（検索語そのものは保存しない）。新しい検索は IP ごとに1時間30回まで。

## 運営管理画面（任意）

イベント・セトリの状態（件数・更新日時・保存期限・公開状態など。入力内容は表示しない）を一覧できる。

1. 管理キーを作り、Cloudflare に登録する（キーは手元で安全に保管する）

```bash
openssl rand -hex 32                          # 表示された文字列が管理キー
npx wrangler@4 secret put ADMIN_TOKEN         # 上の文字列を貼り付ける
```

2. https://shiori.whathides.co.jp/?page=admin を開き、管理キーを入力する

- `ADMIN_TOKEN` を設定しない場合、管理画面のAPIはすべて拒否する。
- 管理キーはブラウザのタブを閉じると消える（sessionStorage に一時保存）。
- 管理キーを変える場合は、手順1をやり直す（古いキーは使えなくなる）。

## うまくいかないとき

| 症状 | 確認すること |
| --- | --- |
| 保存すると「通信に失敗しました」 | `API_BASE` が正しいか（`https://`、末尾 `/` なし）。`ALLOWED_ORIGINS` が `https://shiori.whathides.co.jp` と完全一致しているか |
| 「保存先の準備ができていません」（503） | `wrangler.toml` の R2 設定（`binding = "BUCKET"`、バケット名）が正しいか |
| Actions が「API_BASE を設定してください」で失敗 | 手順4-1 の変数を設定する |
| 独自ドメインで開けない | DNS の CNAME、Pages の Custom domain、HTTPS 証明書の発行状況 |

## 補足

- `dist/server/` は画面とAPIを1本で配信する Worker で、ローカル確認や Cloudflare だけで公開する場合に使う。GitHub Pages 構成では使わない。
- GitHub Pages ではレスポンスヘッダーを設定できないため、イベントページの検索除外は画面側で `noindex` を付けている。トップページは検索対象のまま。
