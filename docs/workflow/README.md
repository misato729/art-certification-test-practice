# 進捗・引き継ぎ・完了判定

この仕組みは、依頼範囲・文脈・進捗・検証根拠を会話の記憶と分けて保存するためのものです。Node.js標準機能だけで動き、アプリ・DB・外部サービスを起動しません。

## 開始時に読む順序

1. リポジトリの `AGENTS.md` と `git status --short` を確認する。
2. `node scripts/context.mjs status` で進捗・世代番号・前回からの変化を見る。
3. `node scripts/context.mjs start development` などで今回の文脈カードを読む。
4. 対象タスク、最新の引き継ぎ、必要な根拠だけを読む。全ログ・全資料の再読込は毎回行わない。
5. 現在のユーザー依頼と依存関係を照合し、着手できる作業を選ぶ。

スクリプトは自分の配置を基準にリポジトリを見つけます。リポジトリ内の別ディレクトリから実行する場合も、参照・出力はそのリポジトリ内だけです。

## ファイルの役割

| ファイル | 役割 |
| --- | --- |
| [state.json](state.json) | 作業・依頼の根拠・受入条件・評価履歴・依存関係の正本 |
| [policy.json](policy.json) | ローカル専用資料の保護対象。CLIと送信検査が同じ定義を使う |
| [contexts/product.md](contexts/product.md) | 学習設計・サービス方針 |
| [contexts/development.md](contexts/development.md) | 実装・検証の入口 |
| [contexts/operations.md](contexts/operations.md) | 資料・DB・配信の運用境界 |
| [task.example.json](task.example.json) | タスク記述の例。自動登録・自動着手しない |
| `handoffs/*.json` | 区切りごとの不変の引き継ぎ記録。最新のパスはstateに記録 |

共通方針はAGENTS、現在地はstate、詳細な検証結果は既存の検証資料へ記録し、同じ内容の正本を増やしません。カードは64KiB以内の短いMarkdownとし、大きな資料は直接転載しません。

## 新しいサービスの初期状態

同梱stateは世代0・タスク0件・引き継ぎなしです。派生元の完了履歴、受験分野、資料名、承認履歴を継承しません。最初の `check --strict` は基準記録がないため終了コード2になります。これはアプリの検査失敗ではありません。

実際の依頼を受けたら例を参考にタスクを追加し、依頼の参照先・受入条件・検証方法・担当者・総評価回数の上限を具体化します。例の `not_requested` を根拠なしで `requested` へ変更しません。既存の完了履歴を採用する場合に限り `legacy_task_ids` へ限定列挙でき、新基準の再検証済みとは表示しません。

## 状態と依存関係

- `todo` / `doing`：依頼済みの未着手／作業中。
- `waiting_for_material`：資料・必要な回答待ち。独立した別作業は継続できる。
- `waiting_for_request`：候補・未依頼の操作。自動着手しない。
- `needs_review`：評価上限に達した未完了作業。原因・計画の見直しまで再試行しない。
- `done`：受入条件と依存作業が確認でき、合格評価を記録した状態。

`next` は依頼済み・依存関係解消済みの候補を示すだけです。`graph --format mermaid` / `graph --format json` は同じ `depends_on` から依存元→後続作業を表示します。別のグラフ定義を正本にせず、エージェントやコマンドも実行しません。

## 完了条件と上限付きの再評価

着手対象のタスクには `acceptance` と `execution` を定義します。例は [task.example.json](task.example.json) を参照してください。

- 受入条件の種類は自動検査 `automated` と独立レビュー `review`。両方を含める。
- 結果は `pending` / `passed` / `failed`。実際に確認してから結果・根拠・確認日を記録する。
- 合格には根拠ファイルと確認日が必要。レビューには実装担当と異なる担当者名も必要。
- 検証方法は説明であり、シェルとして実行しない。コマンド名を書いただけで実行済みにしない。
- 自動検査は変更に必要なものを選ぶ。軽い差分検査などで足りる変更に、実装をなぞる新しいテストや全件ビルドを一律に追加しない。

```sh
node scripts/context.mjs gate --task task_id
node scripts/context.mjs attempt --context development --task task_id \
  --outcome failed --expect-revision 0 \
  --summary '不合格の条件と原因を検証資料に記録した' \
  --next '指摘を修正して残りの評価回数内で再評価する'
```

ID・番号・文章は現在の作業に合わせます。`max_attempts` は初回を含む総評価回数で1〜5回です。初回が不合格で上限3回なら、残りの評価は2回です。個々の検査コマンドの実行回数とは区別します。

上限未満の不合格は `rework`、上限到達は `exhausted`。最後の不合格評価を記録すると状態を `needs_review` にします。上限後は成功と報告せず、履歴の消去・状態だけの変更・上限の繰り返し引上げで延命しません。依頼や条件が変わった場合は旧記録を残して別タスクへ分けます。

全条件がそろったら `--outcome passed` で実施済みの合格評価を保存します。この時点では状態はdoingのままです。タスク全体の `evidence`・`last_verified_at`・`verification_scope` を記録した後で完了にします。

```sh
node scripts/context.mjs checkpoint --context development --task task_id \
  --status done --expect-revision 1 \
  --summary '受入条件と独立レビューを確認した' \
  --next '追加依頼を待つ'
```

`gate` はpassedなら0、未達・待機・legacyなら2、入力不正なら1を返します。記録の構造・根拠の存在をコードで確認しても、内容の正確性や実際の検査実施を証明したことにはなりません。資料・画面・業務上の判断は、実際の照合・操作・別担当レビューで確かめます。

## 引き継ぎ・更新競合・鮮度

大きな区切り、資料受領、重要な検証、文脈切替、終了前に状態と対象カードを更新し、現在の世代番号を指定して `checkpoint` を残します。古い記録は上書きしません。

`attempt` と `checkpoint` は更新ロック・世代番号・更新中のstate変更を確認し、記録作成後にstateを一括置換します。並行更新の担当を1名にまとめ、世代が変わったら最新状態を読み直して合流します。稼働中の `.context.lock` を自動削除しません。中断した残骸と確認できた場合だけ除去します。

記録はGitのHEAD・変更ファイル名と状態、`watch_files` に指定した小さなファイルのSHA-256、stateのハッシュ、UTC日時を保存します。問題本文・Git差分本文・秘密値を自動収集しません。手入力の要約にも含めないでください。

`status` は根拠・Git・stateの変化を表示します。`check --strict` は基準なし・記録後の変化・ローカル資料の不足で2を返します。ハッシュ一致はテスト・DB・外部環境の再検証ではありません。読取専用確認で資料不足が分かった場合は歴史的な完了状態を勝手に変更せず、現在の判定と依存する後続作業に不足を伝えます。

根拠はリポジトリ相対パスだけを許可します。外への参照・外へ向くリンク、隠しファイル、秘密値・DB、巨大な自動収集を避けます。カードは64KiB、毎回のハッシュ対象は1ファイル1MiB以下です。通常の `frontend/server/operations/` のソースは参照できます。

## ローカル専用資料の保護

既定は任意の深さの `local-only/` 配下です。GitとDockerから除外し、送信前の検査は追跡対象と送信される全履歴のファイル名を確認します。現在は削除済みでも履歴に残る資料は検出します。資料本文やblobは読みません。

保護対象はpolicyのディレクトリ名 `directory_names` とファイル名の接頭辞 `filename_prefixes` で変更できます。大文字・小文字とUnicode表記を正規化し、名前は任意の深さで、接頭辞はファイル名で照合します。絶対パス、区切り、ワイルドカードは使いません。設定ファイルがないときも既定保護を維持し、不正設定では停止します。

```json
{
  "schema_version": 1,
  "local_only": {
    "directory_names": ["local-only", "restricted-materials"],
    "filename_prefixes": ["reference-"]
  }
}
```

policyの変更だけで `.gitignore`・`.dockerignore` が自動更新されるわけではありません。必ず両方へ同じ保護対象と必要な大文字小文字のパターンを加え、Git除外とDockerのビルド対象を確認してください。秘密ファイルは保護対象に指定しても根拠として読めるようにはなりません。

```sh
node scripts/check-private-sources.mjs
```

ローカルのpre-pushはコピーしただけでは有効になりません。既存設定を確認し、未設定のリポジトリで明示的に導入する場合だけ、次を実行します。

```sh
git config --local --get core.hooksPath
git config --local core.hooksPath .githooks
```

既存フックがある場合は上書きせず、そのフックへ検査を統合するか担当者と調整します。`--no-verify`・強制追加・別名コピーで保護を迂回せず、履歴の書換え・強制pushも無断で行いません。CIは全履歴を取得し、資料保護と軽量回帰検査が通ってからアプリの検査へ進みます。

## 実行範囲と確認

この仕組みは、サーバー起動、DB操作、資料の外部送信、自動コミット、予約実行、別チャットへの送信を行いません。stateや過去の承認記録で権限を増やさず、現在のユーザー指示を優先します。派生サービスごとの認証・DB方式・配信停止状態は、それぞれの実装と運用に従います。

```sh
node --test --test-concurrency=1 scripts/context.test.mjs scripts/workflow-policy.test.mjs scripts/workspace-policy.test.mjs scripts/check-private-sources.test.mjs
node scripts/context.mjs check
node scripts/context.mjs graph --format json
```

この軽量検査だけならアプリの依存関係の導入、Docker・DB・ブラウザ・本番ビルドは不要です。業務機能の変更がある場合は、[アプリの検証手順](../testing.md)から必要なものを選んで追加します。
