# 共有スキーマとブラウザテスト

## 検証ルールの正本

試験設定・問題・表示ブロックの基本形式は、`frontend/shared/`のZodスキーマで定義します。画面・API・問題取込・設定検査CLIは同じ定義を使用します。管理フォームの入力正規化、アーカイブの厳密な属性検査、公開セットの全問整合、DBの外部キーなど、入口や保存処理に固有の条件は引き続き検査します。

`config/exam.schema.json`はZodから生成する編集支援用のJSON Schemaです。直接編集しません。分類間の参照や選択肢と設定の対応など、JSON Schemaだけで表現できない条件もあるため、設定・問題を変更したらCLIで確認します。

依存ライブラリを導入したうえで、リポジトリのルートから実行します。

```bash
npm --prefix frontend ci
npm --prefix frontend run schema:check
node --experimental-strip-types scripts/check-template.mjs
```

設定値や問題の内容を差し替えるだけならJSON Schemaの再生成は不要です。Zodの検証ルール自体を変更した場合は生成物も更新します。

```bash
npm --prefix frontend run schema:generate
npm --prefix frontend run schema:check
```

DBモデルを変更した場合は`npm --prefix frontend run db:generate`でPrisma Clientを更新し、`npm --prefix frontend run db:validate`でスキーマを確認します。Prismaの生成物はGitへ保存しません。ブラウザテストの実行スクリプトもビルド前にPrisma Clientを生成します。

生成物と正本のずれはCIでも検知します。単体・APIテスト、型検査、本番ビルドの手順は[README](../README.md#検証と構成)を参照してください。

## ルーティング・フォームの回帰検証

APIテストはNitroの公式ファイルスキャナーとH3ルーターで実際のメソッド別ルートを登録します。URLの優先順位、HEAD、OPTIONS、未知URL・未対応メソッドのJSONエラー、Origin/JSON検査、管理権限を検証します。

フォームは共有Zodスキーマの境界値と、APIエラーの項目への対応を単体テストで確認します。PlaywrightではPC・スマートフォンで不正入力時の送信抑止、修正後の送信、退会時のパスワードエラー、通信障害と管理問題の項目別エラーを確認します。管理フォームの表示検証では合成のAPI応答を使い、実際の管理者権限の検査はPostgreSQL/APIテストで行います。

## Playwrightの準備

READMEに記載した対応Node.js、PostgreSQL 16、Chromiumを使用します。E2E用のPostgreSQLはローカルの検証専用環境を用意し、接続ユーザーに一時DBを作成・削除する権限を付与します。起点となるDB名は`_test`で終わる名前にします。既存サービスや本番DBのURLは指定しません。

リポジトリ直下にGit管理対象外の`.env.e2e`を作成し、検証用の接続先を設定します。次は専用のローカルDocker環境を使う例です。`REPLACE_WITH_TEST_PASSWORD`の2箇所を、検証専用の同じパスワードへ置き換えます。URLへ記載するため、英数字だけの十分長いランダムな値を使用します。

```dotenv
POSTGRES_USER=exam_e2e
POSTGRES_DB=exam_e2e_test
POSTGRES_PASSWORD=REPLACE_WITH_TEST_PASSWORD
E2E_DATABASE_URL=postgresql://exam_e2e:REPLACE_WITH_TEST_PASSWORD@127.0.0.1:55439/exam_e2e_test
```

リポジトリのルートから専用PostgreSQLを起動します。既存のテンプレート用Composeとは別のコンテナです。`pg_isready`が接続可能と返してからテストを実行します。

```bash
docker run --detach --name exam-template-e2e-db \
  --env-file .env.e2e --publish 127.0.0.1:55439:5432 postgres:16-alpine
docker exec exam-template-e2e-db pg_isready -U exam_e2e -d exam_e2e_test
```

すでに検証専用のPostgreSQLがある場合は、そこに作成した`_test`で終わるDBのURLを`E2E_DATABASE_URL`へ指定すれば、このコンテナは不要です。

`frontend`で初回のブラウザをインストールし、テストを実行します。Linuxでは`npx playwright install --with-deps chromium`で必要なOSライブラリも導入します。

```bash
cd frontend
npx playwright install chromium
node --env-file=../.env.e2e scripts/run-e2e.mjs
```

すでに`E2E_DATABASE_URL`を環境変数で設定している場合は、`npm run test:e2e`でも実行できます。テストコマンドは先に本番ビルドを作成するため、古いビルドを対象にしません。

上の例で作った専用コンテナを使い終えたら、次で検証用データごと削除できます。

```bash
docker rm --force --volumes exam-template-e2e-db
```

## 分離と確認範囲

テストはPCとスマートフォンの表示幅で、会員登録・ログイン・問題演習・履歴・お気に入り・ログアウトなどをブラウザから操作します。テスト用の合成会員を使用し、Stripeや外部通知を使いません。

同梱の操作シナリオは`payments.enabled=false`で、公開済みの問題が1問以上ある構成を対象にします。問題や正答位置、選択肢数は同梱データから読み取ります。課金を有効にした派生サービスでは、その利用資格や購入導線に合わせたブラウザシナリオを追加してください。既存の課金APIの回帰テストは引き続き実行します。

起点の接続先を確認した後、実行ごとにランダムな名前の新しいDBを作成し、マイグレーションと同梱問題の取込を実行します。既存の問題・会員データは読み込みません。テスト用の認証秘密値も毎回生成します。ビルドも`frontend/.e2e-build/`内の実行ごとの専用ディレクトリを使用し、通常の開発用・配信用の出力を上書きしません。サーバーはループバックアドレスの専用ポート（標準3318）で起動し、通常の`3400`のアプリを再利用しません。必要な場合は`E2E_PORT`で空いているポートへ変更できます。

通常終了、テスト失敗、終了シグナルの処理でテスト用サーバーを停止し、一時DBと専用のビルド出力を削除します。マシンの強制終了などで後処理できなかった場合は、検証環境に残った`exam_e2e_…_test`と`.e2e-build/`内の該当する出力だけを確認して削除してください。

Playwrightのレポートや失敗時の画像などは`frontend/playwright-report/`・`frontend/test-results/`に保存され、Git管理しません。GitHub Actionsでは独立したPostgreSQLを使用し、失敗時の診断ファイルは7日間保存します。

## ハーネスの軽量回帰検査

進捗・完了条件・資料保護だけの変更は、リポジトリのルートで次を実行できます。Node.js標準機能と合成の一時Git環境を使い、アプリの依存関係、DB、Docker、ブラウザを必要としません。

```bash
node --test --test-concurrency=1 scripts/context.test.mjs scripts/workflow-policy.test.mjs scripts/workspace-policy.test.mjs scripts/check-private-sources.test.mjs
node scripts/context.mjs check
node scripts/check-private-sources.mjs
```

検査は原資料を読み込まず、設定・パス・状態・履歴のメタデータを扱います。初期状態の`check --strict`は基準記録がないため終了コード2で、実施済みのアプリ検証を示しません。アプリやDBも変更した場合は、該当する既存の検査を別途実行してください。

GitHub Actionsの`harness`ジョブで先に資料保護とこの回帰検査を行い、成功後に既存のアプリ・ブラウザ検査へ進みます。
