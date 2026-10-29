# DB移行・バックアップ・復元

## 現在の構成

Nuxt 4の画面とNitroのTypeScript APIを、1つのNode.jsプロセスで配信します。Composeのサービスは`frontend`とPostgreSQL 16の`db`です。Ruby、Rails API、別のAPIサーバーは不要です。

本番イメージの起動は`npm run db:migrate`の後に`node .output/server/index.mjs`を実行します。自動seedは実行しません。開発イメージだけがマイグレーション後に`npm run db:seed`を実行し、`development`環境の空の問題テーブルに同梱サンプルを取り込みます。

DB接続は`DATABASE_URL`、又は`PGHOST`・`PGPORT`・`PGDATABASE`・`PGUSER`・`PGPASSWORD`を使用します。Composeでは`DB_HOST`・`DB_NAME`・`POSTGRES_USER`・`POSTGRES_PASSWORD`から接続します。秘密値は対象環境で設定し、`config/exam.json`へ書きません。

## Prisma・Prisma Migrateへの移行

業務DB操作はPrisma Client、Better AuthのDB接続は公式Prismaアダプターを使用します。認証方式・Cookie・パスワード処理はBetter Authを維持します。回数制限は`rate-limiter-flexible`の公式PostgreSQLストアを使用し、専用の`pg`プールを最大2接続で共有します。Kyselyとnode-pg-migrateは使いません。PostgreSQL固有の行ロック・アドバイザリロック・カタログ照合には限定的にSQLを使います。

新しい派生サービスは空のDBから起動してください。`npm run db:migrate`はPrisma Migrateの`migrate deploy`で初期スキーマと以後の未適用マイグレーションを適用します。`schema.prisma`は型付きモデル、`prisma/migrations/*/migration.sql`は実際に適用するDDLの正本です。

```bash
# frontend/内で実行。開発用の別DBへ新しいマイグレーションを作成する。
npm run db:generate
npm run db:migrate:dev -- --name describe_change
# 配信時は作成済みSQLのみを適用する。
npm run db:migrate
```

CHECK制約、正答1件・pending購入1件等の部分一意インデックスはSQLで維持します。既存DBの外部キーを変更せず引き継ぐため、Prismaモデルと初期SQLでも従来の`fk_rails_...`という制約名を保持します。この名前は履歴上の識別子で、Railsの実行環境は不要です。生成SQLを確認して必要な制約を追記し、適用済みのSQLを編集しません。`migrate dev`・`db push`を本番へ実行しないでください。失敗したマイグレーションはPrismaの状態とDBを確認して対応し、データ復旧は確認済みバックアップから行います。

### 既存テンプレートDBを引き継ぐ場合

稼働中のDBにはこの移行を自動適用しません。先にバックアップを別DBへ復元し、書き込みを止めてから新しいイメージを準備してください。空でない既存DBの初回は、通常の`db:migrate`だけでは初期スキーマを作成できないため、明示的なbaselineが必要です。

```bash
docker compose build frontend
# 復元先のDBで先に検査する。DB接続は対象環境の設定で明示する。
docker compose run --rm frontend npm run db:baseline
docker compose run --rm frontend npm run db:migrate
```

`db:baseline`は初期マイグレーションに対応する固定スナップショット`frontend/prisma/baseline.prisma`への差分検査と、CHECK制約・部分一意インデックスの照合に成功してから、Prismaの履歴へ初期マイグレーションだけを適用済みとして登録します。現在の`schema.prisma`へ追加したモデルはこの初回照合へ混ぜず、続く`db:migrate`で未適用マイグレーションとして追加します。初期SQLとbaselineスナップショットは書き換えません。不一致・未知のスキーマは自動採用せず拒否します。DBのreset、テーブル再作成、データ・既存IDの再投入は行いません。

旧`pgmigrations`・`nitro_schema_migrations`とRailsの`schema_migrations`・`ar_internal_metadata`は履歴を保持するため、Prisma 7の`externalTables`機能（Preview）で管理対象から除外します。`DATABASE_URL`の`schema`指定（省略時は`public`）内のこの4テーブルだけを明示し、存在するテーブルや行の削除・作成・更新は行いません。除外は以後のマイグレーションでも維持します。問題・利用者・認証・決済などの業務テーブルは除外せず照合します。この4テーブル以外の追加テーブルや業務スキーマの不一致がある場合は、バックアップの復元先で差分を確認し、照合を無視してbaselineしないでください。問題が既存の場合のimportも引き続き拒否します。

Better Auth以前のユーザー、bcryptパスワード、独自Bearerトークンの引き継ぎは対象外です。新しい管理者は未登録のメールアドレスで`admin:create`から作成してください。設定は`BETTER_AUTH_SECRET`（64文字以上のランダムな値）と`BETTER_AUTH_URL`（本番は実際のHTTPSオリジン）です。画面とAPIは同一オリジンで配信し、開発ポートを変更する場合も`BETTER_AUTH_URL`・`CORS_ORIGINS`を一致させます。

更新後はヘルスチェック、会員登録、ログイン・ログアウト、管理画面、履歴・お気に入りを確認してください。課金するサービスでは販売を止めた状態で、購入・Webhook・利用資格・退会時の購入待ち失効も検証します。

### 共通の回数制限ストアへの更新

`20261024010000_library_rate_limits`は`rate_limiter_flexible`テーブルと期限のインデックスを追加します。公式PostgreSQLアダプターの形式に合わせ、`key`は`varchar(255)`の主キー、`points`は整数、`expire`はエポックミリ秒のnullableな`bigint`です。DDLはPrisma Migrateが管理し、実行時のライブラリにはテーブルを作成させません。

マイグレーションは旧`api_rate_limit_buckets`の有効なHMACキー・回数・期限を新テーブルへコピーします。移行時点で期限切れの行はコピーしません。100万回を超える値は、拒否状態を維持しつつ整数の追加更新に余裕を残すため100万へ丸めます。旧テーブルと初期マイグレーションは互換性のために残し、更新後のアプリは新テーブルだけを使用します。問題・利用者・認証セッション・決済のデータは変更しません。

業務APIのHMAC生成形式と固定区間は維持します。Better Authの標準ルールも同じストアへ接続し、既存と同じIP表現の会員登録・ログインは同じHMACキーを使用します。IPv6はBetter Authによる表記の正規化が加わるため、旧キーの表記と異なる場合は認証の回数が更新時に一度リセットされます。上限値と区間の長さは変わりません。

複数のNode.jsプロセスは同じPostgreSQLテーブルで原子的に回数を共有します。Redisや追加のDBサービスは不要です。回数制限専用の最大2接続は業務用Prismaプールと別枠なので、ホスティング先の接続上限を計画するときに合算してください。終了時はNuxt・運用CLIから専用プールを閉じます。

## DB全体のバックアップ

問題アーカイブにはユーザー・履歴・購入情報を含みません。DB全体のバックアップはPostgreSQLの`pg_dump`で取得し、アプリの設定・秘密値も別の安全な場所に保管します。バックアップファイルは個人情報を含むため公開・Git管理しません。

次はローカルComposeの対象DBから取得する例です。出力先は未使用のファイル名にし、既存バックアップを上書きしないでください。

```bash
mkdir -p ../exam-practice-backups
chmod 700 ../exam-practice-backups
umask 077
docker compose exec -T db sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' \
  > ../exam-practice-backups/before-nitro.dump
```

取得に成功したこと、ファイルが空でないこと、別DBへ復元できることを確認します。本番はホスティング先のバックアップ方針・保持期間に合わせ、復元先を明示して実施します。稼働中のDBへ直接復元する手順は用意していません。

## 問題だけのアーカイブ

```bash
docker compose exec -e OUTPUT=/tmp/questions-export.json frontend \
  npm run operations -- questions:export
docker compose cp frontend:/tmp/questions-export.json ./questions-export.json
```

形式は`format: "exam-practice-question-archive"`・`version: 1`で、問題・選択肢の件数と、キー順を正規化したJSONのSHA-256を含みます。旧Rails版の同形式のアーカイブも受け付けます。書き出し先の既存ファイルは上書きせず、コンテナ内のファイル権限は`0600`です。秘密の出題内容を含む場合は、回収後の保管先にも適切な権限を設定します。

空の問題DBへ取り込むときは、ファイルをコンテナへ置いて入力先を明示します。

```bash
docker compose cp ./questions-export.json frontend:/tmp/questions-import.json
docker compose exec -e INPUT=/tmp/questions-import.json \
  -e CONFIRM=IMPORT_INTO_EMPTY_DATABASE frontend \
  npm run operations -- questions:import
```

属性、表示ブロック、分類、番号、選択肢、正答数、出典、件数、照合値を検査します。問題又は選択肢が既存の場合や、公開セットが設定した問題数を満たさない場合は拒否し、途中まで保存しません。SHA-256は内容の破損・変更を検出するための値で、作成者を認証する電子署名ではありません。

## 復元演習

`operations:restore_drill`は実データをコピーせず、合成データだけでバックアップ・復元とサービスの読み取りを確認します。ローカルの`test`環境と、`db`・`localhost`・`127.0.0.1`・`::1`の接続先だけを許可します。販売と外部通知は無効にしてください。

```bash
docker compose exec -e APP_ENV=test -e DB_NAME=exam_practice_test \
  -e PAID_MEMBERSHIP_ENABLED=false -e ERROR_NOTIFICATIONS_ENABLED=false frontend \
  npm run operations -- operations:restore_drill
```

接続ユーザーには使い捨てDBの作成・削除権限が必要です。DBと同じメジャーバージョンの`pg_dump`・`pg_restore`を使用します。標準イメージはPostgreSQL 16用クライアントを含みます。

演習は毎回、新しいDBを2つ作り、片方にスキーマと合成の利用者・問題・履歴・お気に入り・決済・利用資格を作成します。バックアップをもう片方へ復元し、全行の件数と照合値、制約、インデックス、シーケンスを比較します。さらにBetter Authによるパスワード照合・DBセッション、利用資格、回答前の正答非公開、履歴・お気に入り、管理者権限をTypeScriptサービスから確認します。外部Stripe通信やメール通知は行いません。

結果は件数・検査の成否だけを出力し、一時ファイルと作成したDBを削除します。実際のホスティング先のバックアップ復元や、切り替え後のHTTP・ブラウザ確認は別途実施してください。
