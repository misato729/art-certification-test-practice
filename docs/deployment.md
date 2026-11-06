# 美術史ラボのクラウド配信

2026年11月4日の依頼により、他のラボと分離した新規環境を作成しました。追加指定に合わせ、3サービスのプロジェクト名は`art-history-practice`です。11月6日の更新では、全5回を各85問（美術史80問＋活用5問）、全問4択として既存環境へ反映しました。以下の初回配信記録と、末尾の更新記録を区別します。

| 用途 | 配信先・構成 |
| --- | --- |
| 公開画面 | https://art-history-practice.netlify.app/ |
| API | https://art-history-practice.fly.dev/ |
| DB | Neon `art-history-practice`、PostgreSQL 16、Singapore、mainブランチ |
| APIマシン | Fly.io personal組織、nrt、shared CPU 1・1GB、1台、停止/自動起動 |

Netlifyの公開版は手動で配信した静的サイトです。初回（2026年11月4日）はGit連携後に`stop_builds=true`を設定しました。今回（11月6日）の配信前には`misato729/art-history-practice`のmain連携と`stop_builds=false`を観測し、その設定を変更せず、検証済みpublicだけをCLIの`--no-build --prod`で配信しました。秘密スキャンの停止・除外設定も追加していません。GitHub Actionsの検査は継続します。

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

## 初回配信のDBと問題

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

## 初回配信の確認と制限

静的生成と型検査、生成HTML/JS/CSS・redirect一致・保護対象の混入なしを確認しました。Fly初回buildの相対パス誤りは修正済みです。新規Netlifyはprivate初期状態だったため、この新規サイトのproductionだけをMake publicで公開しました。他のサイトやチーム既定の公開設定は変更していません。

公開URLのhealth/exams/study_categories/問1は200、1模試85問・41分類、4選択肢と回答前の正答/解説非開示を確認しました。未ログインの管理APIは401、Better Authのget-sessionは200です。

公開画面は読取のみで、PCの問1の4択・受験世界史13件/両方23件・解除後85問、問81の6択を確認しました。390pxで条件指定のページ幅390px・横はみ出しなしを確認し、公開画面の画像をlocal-onlyへ保存しました。会員作成・回答送信・管理編集を公開DBで検証していません。PC/SPの会員操作を検証した前回の隔離E2Eと区別します。

初回のHTTP確認ではmacOSのPython側のCA設定で証明書検証エラーとなりました。検証を無効化せず、OS標準curlと実ブラウザでHTTPS接続を確認しています。

Fly.io公式CLIは一時領域へ導入し、既存のシェル設定/PATHは変更していません。配信用の専用秘密設定・操作用スクリプト・非秘密メタデータ・確認画像は`local-only/cloud-deploy/`へ保存し、Git/Docker・静的配信の対象から除外しています。既存のスキルやMCPを削除・置換していません。

## 初回のGit連携とビルド停止

Git連携時にはNetlifyがビルドを有効化するため、連携後にUIでStopped buildsを保存し、APIでrepo/mainとstop_builds=trueを再確認しました。連携時に初回デプロイ1件が自動作成されましたがerrorで終了し、公開されていません。公開中のproduction deployは6aeb081120217ca85b03ef73のままです。実装コミットf6afdc5には[skip netlify]も付け、push後もstop_builds=true・デプロイ履歴2件（増分0）・公開版の維持を確認しました。GitHub Actions run41818378785はharness・verify・browserの全3ジョブが成功しました。原資料・接続設定・ローカルNeon関連付けは送信していません。


## サイドバー・静的トップ・誤答復習の更新

2026年11月4日の追加依頼で、実装cf4347cと検査期待値修正d09b787をmainへpushし、CI41824958247の全3ジョブ成功後に手動再配信しました。Netlifyの公開deployは6aeb1f4e8f449c0ed2642dcd、Fly imageはregistry.fly.io/art-history-practice:git-d09b787です。Netlify CLIのno-build/production指定で静的112ファイルのみをアップロードし、Git連携とstop_builds=trueを維持しました。今回の履歴増分は手動1件だけで自動配信0です。Flyは同じmachine 82d1315b246478/nrt/shared1CPU/1024MBと環境/注入ファイルを保持しています。DBモデル/マイグレーションの追加はありません。公開HTTPと匿名PC/SPの確認は成功し、会員作成/回答送信は隔離CIの検証と区別します。詳しくはdocs/verification.mdを参照します。


## 模擬試験1〜5・全85問4択の更新（2026年11月6日）

ユーザーのAPI配信・問題登録・Netlify配信の指定により、新模試2〜5の340問と144図版を追加し、既存模試1の活用5問を4択へ整理しました。全5回が各85問（美術史80問＋活用5問）・全問4択です。既存85問の問題IDと残す選択肢ID、旧美術史80問の内容と関連構造を保持しています。対象履歴0を確認し、未参照の余剰誤答10肢だけを除去しました。既存の認証/会員データとDB schemaは変更していません。

Fly imageはregistry.fly.io/art-history-practice:deployment-01M6Q6QJDMKNT1E446BTGWYG4P、既存machine/構成/環境・秘密の指紋を保持。Netlify公開deployは`6aed37cc260745bcba14c2aa`、291静的ファイルだけを手動配信し、配信前に観測したstop_builds=falseとGit main連携を保持しました。初回の900秒枠での問題登録は失敗して全rollback、待ち時間だけを見直したprivate処理の第2回は980秒で確定し、READ ONLY再実行は変更0でした。

公開425問の全4択/原稿一致/非開示、公開179図版/19HTMLの全指紋、Netlify API中継40問、匿名PC/SP66画面・拡大8件を確認しました。初回データ控え・独立答案・接続設定・操作記録・PNG証拠は保護領域に置き、Git/Docker/静的配信へ含めません。詳細と検証の範囲は[検証記録](verification.md)を参照します。
