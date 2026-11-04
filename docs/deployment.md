# 美術史ラボのクラウド配信

2026年11月4日の依頼により、他のラボと分離した新規環境を作成しました。追加指定に合わせ、3サービスのプロジェクト名は`art-history-practice`です。

| 用途 | 配信先・構成 |
| --- | --- |
| 公開画面 | https://art-history-practice.netlify.app/ |
| API | https://art-history-practice.fly.dev/ |
| DB | Neon `art-history-practice`、PostgreSQL 16、Singapore、mainブランチ |
| APIマシン | Fly.io personal組織、nrt、shared CPU 1・1GB、1台、停止/自動起動 |

Netlifyの公開版は手動で配信した静的サイトです。2026年11月4日の追加依頼でGitHubの`misato729/art-certification-test-practice`（main）へ連携し、Build statusをStoppedに設定しました。`stop_builds=true`を確認し、自動ビルド・自動デプロイは停止しています。必要な更新はローカルで静的生成してCLIで手動配信します。GitHub Actionsの検査は継続します。

## 配信設定

- `netlify.toml`: frontendをNode 24で静的生成し、`.output/public`だけを配信。
- `frontend/public/_redirects`: `/api/*`をFlyへ強制中継し、その他の未生成URLを`200.html`へ送る。
- `frontend/fly.toml`: nrt配置、公開Origin/URL、HTTPS、health check、直接接続を使うPrisma Migrateのrelease commandを設定。
- `frontend/Dockerfile`: production起動時の移行だけ`DIRECT_DATABASE_URL`を使い、未設定時は従来の`DATABASE_URL`へ戻る。
- `frontend/app/pages/index.vue`: 公開模試一覧をクライアントで取得して静的生成のDB依存を除き、初回取得後に対象模試を全選択する。
- `.gitignore` / `.dockerignore`: 生成された`frontend/dist`とローカルのNeon関連付け`.neon`を除外。

Flyのビルドはリポジトリ直下で実行します。現CLIではDockerfileはconfigディレクトリ基準、COPYのbuild contextは渡したリポジトリ直下です。

```sh
fly deploy . --config frontend/fly.toml --remote-only --ha=false
```

新規アプリ専用のDB URLとBetter Authの秘密値をFly secretsへ登録しています。既存ラボの認証情報やDBは転用していません。既存Prisma接続が`search_path`のstartup optionを使い、Neonのpoolerが拒否するため、現配信は直接接続を使用します（[Neonの接続エラー説明](https://neon.com/docs/connect/connection-errors#unsupported-startup-parameter)も参照）。接続数上限や既存のUTC/schema処理は維持しています。

## DBと問題

Prisma Migrateで4マイグレーションを適用しました。空DBへ共通writerを使って85問・350選択肢・23大問・12共通本文を登録し、明示承認された分類41件（親13・小分類28）も登録しました。問題との新しい分類の関連付けはしていません。分類選択時は0問・開始不可のままです。

初回の標準取込は失敗してロールバックされ、問題0件を確認しました。クラウド往復を伴う初回登録に限り、外側の取込transactionの期限を300秒へ延ばして共通処理を実行しました。アプリのtransaction期限や書込実装は変更していません。取込完了後の再確認は85問を保持し、分類はunchanged41件・created0件でした。

原本PDF・画像は送信していません。分類マスター41件のNeonへの登録は、local-only資料の外部送信制限について説明したうえでユーザーの明示承認を受けました。原資料・接続設定・バックアップ・確認画像は引き続きGit/Dockerの対象外です。

## Neonのエージェント環境

指定URL https://neon.com/.well-known/agent-skills/neon/SKILL.md を取得して読み、導入済みファイルとのバイト一致を確認しました。

導入前はプロジェクト内のNeonスキル/MCPとも未設定でした。既存のローカル`.env`を保持するため、envを自動取得する一括initを使わず、不足する部分だけ追加しました。

- `.agents/skills/neon/`と`.agents/skills/neon-postgres/`: Codex向けに追加。`neon skills status`で両方up to date。
- `skills-lock.json`: スキルの取得元・バージョン照合情報。
- `.codex/config.toml`: OAuth方式のNeon MCPを追加。接続URLは今回のNeon project IDに限定。APIキーは含めない。
- `.neon`: 新規プロジェクトのorg/project/mainブランチへ関連付け。`--no-env-pull`を使用し、既存`.env`を上書きしない。

`codex mcp list --json`でNeon enabledを確認しました。MCPのOAuthはCLIログインとは独立し、初回接続時の本人承認が必要です。現在はnot_logged_inで、MCPからの実ツール呼出しは未確認です。デプロイには認証済みNeon CLIを使用しました。

Better Auth・Prisma・pgは維持し、Neon Auth/Functions/Data API等の新しいサービスや依存パッケージは追加していません。既存AGENTS.md、ローカル接続設定、他のラボとグローバルMCP設定は変更していません。

## 配信確認と制限

静的生成と型検査、生成HTML/JS/CSS・redirect一致・保護対象の混入なしを確認しました。Fly初回buildの相対パス誤りは修正済みです。新規Netlifyはprivate初期状態だったため、この新規サイトのproductionだけをMake publicで公開しました。他のサイトやチーム既定の公開設定は変更していません。

公開URLのhealth/exams/study_categories/問1は200、1模試85問・41分類、4選択肢と回答前の正答/解説非開示を確認しました。未ログインの管理APIは401、Better Authのget-sessionは200です。

公開画面は読取のみで、PCの問1の4択・受験世界史13件/両方23件・解除後85問、問81の6択を確認しました。390pxで条件指定のページ幅390px・横はみ出しなしを確認し、公開画面の画像をlocal-onlyへ保存しました。会員作成・回答送信・管理編集を公開DBで検証していません。PC/SPの会員操作を検証した前回の隔離E2Eと区別します。

初回のHTTP確認ではmacOSのPython側のCA設定で証明書検証エラーとなりました。検証を無効化せず、OS標準curlと実ブラウザでHTTPS接続を確認しています。

Fly.io公式CLIは一時領域へ導入し、既存のシェル設定/PATHは変更していません。配信用の専用秘密設定・操作用スクリプト・非秘密メタデータ・確認画像は`local-only/cloud-deploy/`へ保存し、Git/Docker・静的配信の対象から除外しています。既存のスキルやMCPを削除・置換していません。

## Git連携とビルド停止

Git連携時にはNetlifyがビルドを有効化するため、連携後にUIでStopped buildsを保存し、APIでrepo/mainとstop_builds=trueを再確認しました。連携時に初回デプロイ1件が自動作成されましたがerrorで終了し、公開されていません。公開中のproduction deployは6aeb081120217ca85b03ef73のままです。実装コミットf6afdc5には[skip netlify]も付け、push後もstop_builds=true・デプロイ履歴2件（増分0）・公開版の維持を確認しました。GitHub Actions run41818378785はharness・verify・browserの全3ジョブが成功しました。原資料・接続設定・ローカルNeon関連付けは送信していません。
