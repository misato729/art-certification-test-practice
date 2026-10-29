# カスタマイズ手順

## 設定と問題データの役割

| ファイル・場所 | 役割 |
| --- | --- |
| `config/exam.json` | 試験別設定の正本。フロントとAPIが同じファイルを読む |
| `content/questions.json` | 新しい空のDBへ取り込む初期問題 |
| `frontend/public/images/` | ロゴなどの公開素材 |
| 管理画面・DB | 初期取込後の問題の編集・公開状態の正本 |
| `.env` | 開発用ポート、DB接続、認証・決済等の環境ごとの設定 |

`config/exam.json`は公開情報だけを保存します。秘密鍵・DBパスワード・利用者情報は記載しません。

設定と問題の形式は共有Zodスキーマで検証します。設定変更後は`frontend`の依存ライブラリを導入した状態で、リポジトリのルートから`node --experimental-strip-types scripts/check-template.mjs`を実行してください。JSON Schema、CLI、画面・API用に同じ条件を手作業で増やしません。検証ルール自体を変更する場合の生成・テスト手順は[検証の実行方法](testing.md)を参照してください。

## ブランドと説明を変える

`site`で以下を指定します。

| キー | 内容 |
| --- | --- |
| `id` | サービスごとに一意な識別子。英小文字で始まる40文字以内の英小文字・数字・ハイフン。例：`sample-exam` |
| `name` | サービス名 |
| `short_name` | 短いサービス名 |
| `exam_name` | 対象資格・試験の名称 |
| `description` | サービスの説明 |
| `tagline` | トップページの短い案内 |
| `logo_path` | `frontend/public`から配信するロゴのパス。例：`/images/logo.svg` |
| `primary_color` | 基本色。`#2563eb`のような6桁のカラーコード |
| `contact_email` | 問い合わせ先。空欄のまま一般公開しない |
| `overview` | 試験概要ページの本文。`title`と`body`の組を並べる |

`site.id`はログインCookieの名前にも使います。本番環境でもlocalhostの別ポートでも、別サービスには異なる値を設定してください。運用途中で変更すると、以前のCookieを使ったログイン状態は引き継がれません。

ロゴ素材自体の色を変える場合は、SVG等のファイルも編集してください。利用規約・プライバシーポリシー・特定商取引に関する表示は共通の草案です。対象サービスの提供内容・運営者・問い合わせ・データ保存方針に合わせて編集します。

## 問題数・選択肢・分野を変える

- `exam.set_count`：用意する試験セット数。
- `exam.questions_per_exam`：各セットの問題数。公開するセットは問1からこの数までをそろえます。
- `exam.choice_labels`：選択肢の表示順とラベル。例：`["A", "B", "C"]`。各問題の選択肢もこの順序・件数にそろえます。
- `categories.major`：大分類の`value`と`label`。
- `categories.minor`：小分類の`value`・`label`・`major_category_value`。最後の値は登録済み大分類の`value`を指します。

分類の`value`は問題データから参照する識別子です。表示名だけを変える場合は`label`を変更します。各問題の`major_category_code`と`category_code`は、上記設定と一致させてください。

## 問題JSONの形式

`content/questions.json`は次の構造です。以下は説明用の骨組みで、本文や選択肢を省略しています。完全なデータは同梱JSONを参照してください。

```json
{
  "schema_version": 1,
  "questions": [
    {
      "exam_number": 1,
      "question_number": 1,
      "major_category_code": "fundamentals",
      "category_code": "numbers",
      "publication_status": "published",
      "content_blocks": [{ "type": "text", "text": "問題文" }],
      "explanation_blocks": [{ "type": "text", "text": "正答の根拠と各選択肢の解説" }],
      "source_text": "確認した資料名 | https://example.com/replace-with-real-source",
      "choices": []
    }
  ]
}
```

`choices`には、設定したラベル順に全ての選択肢を記載します。

```json
{
  "choice_label": "ア",
  "content_blocks": [{ "type": "text", "text": "選択肢の本文" }],
  "is_correct": true,
  "display_order": 1
}
```

- 各問題の正答は1件です。全選択肢の`display_order`を1から連続させます。
- `publication_status`は`draft`・`published`・`private`です。
- 公開する問題は本文・全選択肢・解説・出典を記載し、同じセットの全問をそろえます。
- `source_text`は`資料名 | https://...`の形式で、複数の場合は改行して記載します。サンプルのダミーURLを実際の出典として流用しないでください。
- `content_blocks`の対応形式は[構成の概要](architecture.md#表示ブロック)を参照してください。

初期問題は、内容の正確性と利用条件を確認したものを用意します。実在する試験の過去問をそのまま複製することを前提としたテンプレートではありません。

## 取込と再起動

開発用Composeの起動時に`npm run db:migrate`と`npm run db:seed`を実行します。`APP_ENV`（未設定時は`NODE_ENV`）が`development`で、問題と選択肢の両方が空の場合だけ初期問題を読み込みます。すでに問題がある場合はseedを再実行しても変更しません。`production`・`test`では自動seedを行いません。

空のDBへ明示的に取り込む場合は次のコマンドを使用します。`INPUT`を省略すると`content/questions.json`が対象です。

```bash
docker compose exec \
  -e CONFIRM=IMPORT_INTO_EMPTY_DATABASE \
  frontend npm run operations -- questions:import_content
```

取込前にデータ全体を検証し、公開セットの不足を含め不正なデータがあればトランザクション全体を取り消します。問題又は選択肢が1件でもあるDBへの取込を拒否します。稼働中サービスの問題を更新する場合は管理画面を使用してください。

設定を変更したらNuxtを再起動します。画面とAPIの両方が同じ設定を使用します。

```bash
docker compose restart frontend
```

配信版をビルドして運用する場合は、`config/exam.json`を含めてNuxtの本番イメージをビルド・デプロイし直します。ブラウザの再読み込みも行ってください。

### 既存DBがある場合

設定の変更によって既存の問題・回答履歴・購入情報が自動変換されることはありません。特に次の変更は、バックアップを取り、別環境で確認してから実施します。

- 分類識別子を変更する：既存問題の分類も対応する識別子へ変更する。
- 問題数やセット数を減らす：設定範囲外になる問題の扱いを先に決める。
- 選択肢数・ラベルを変更する：既存問題と選択肢ID・回答履歴を整合させるデータ移行を別途設計する。現在の管理画面は、設定変更前の選択肢を新しい件数やラベルへ自動変換しません。新サービス向けの変更は、初期取込より前に行います。
- 無料範囲・価格を変更する：提供済みの利用資格や購入条件への影響を確認する。

別の資格試験を作る用途では、各コピーの`.env`に固有の`COMPOSE_PROJECT_NAME`を指定し、新しいリポジトリ・Composeプロジェクト・空のDBから始めると、既存サービスのデータを持ち込まずに設定できます。既存DBを消して差し替える手順は、このテンプレートの通常の更新手順には含みません。

旧版テンプレートから更新する場合の認証・DB移行は、[移行手順](migration.md)を参照してください。問題JSONの取込はスキーマ移行とは別の操作であり、既存DBへ問題を再投入する必要はありません。

## 課金を有効にする

1. `payments.enabled`を`true`にし、`free_exam_count`・`amount`を設定する。無料範囲は先頭のセットからの件数、金額は日本円の整数です。現在の対応通貨は`jpy`のみです。
2. 独立したStripe設定で、設定金額・通貨と一致する一回払いのPriceを作る。
3. `.env.example`を参照し、秘密鍵・Price ID・Webhook署名シークレット・フロントURL・販売者情報を対象環境へ設定する。
4. 対象APIの`/api/v1/webhooks/stripe`へ、購入・返金等の対象イベントが届くようにする。
5. その環境で購入・Webhookによる会員資格の反映・返金による失効を確認し、販売条件と表示を確認してから販売フラグを有効にする。

`payments.enabled=false`はサービス全体を無料で提供する設定です。`true`で販売フラグが無効の場合は、無料範囲と既存会員の利用資格を維持し、新規の購入を停止します。

購入後の戻り画面だけでは会員資格を付与しません。署名検証したWebhookを処理し、金額・通貨・Price ID等を確認した上で利用資格を反映します。定期購読・外貨ごとの価格設計等を追加する場合は、対応する決済処理と表示も実装してください。

## 派生サービスへの修正の反映

このテンプレートから作ったリポジトリへ、テンプレート側の変更は自動で反映されません。共通の修正は、対象サービスとの差分・設定・テスト結果を確認して取り込みます。複数資格を一つのDBで運営する方式や、全サービスで共通ログインを使う方式は、この初期構成には含みません。
