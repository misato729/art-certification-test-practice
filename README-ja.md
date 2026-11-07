# 美術史ラボ：小問表示・活用問題の共通資料対応パッチ

対象: misato729/art-history-practice
基準コミット: ddb2be5ac8b4a046e9d32d2481309ac589457f91

## 何が変わるか

通常問題は小問を中心に表示し、必要な参照本文・画像・表は「この問題の資料」に保持します。活用問題は共通資料パネルと、登録された同じ問題群の小問リンクを使います。サイドバーは「美術史問題」「知識・情報の活用問題」の出題区分に整理します。

通常ランダム演習では活用問題の問題群を分割しない順序を使用します。古いランダムURLや「間違えた問題」復習の順序は維持します。資料は初期状態で開き、下線・空欄への移動、画像拡大など既存の表示機能を利用できます。

DB、問題本文、正答、選択肢、解説、公開状態、履歴を変更する処理はありません。新しい共通テーマや活用問題を作問・登録するパッチではありません。現在の活用問題がそれぞれ別の1問グループであれば、それらを自動的に1つの5問グループへ結合しません。

以前指摘したジャンル絞り込みの未実装など、別の不具合修正は含めていません。

## 1. ZIPを展開

ZIPをダウンロードフォルダーに保存した場合、Macのターミナルで実行します。

```bash
mkdir -p "$HOME/Downloads/art-history-mixed-format"
unzip -o "$HOME/Downloads/art-history-mixed-format.zip" -d "$HOME/Downloads/art-history-mixed-format"
```

既にダブルクリックで同名フォルダーへ展開した場合、この操作は不要です。以下はパッチが `~/Downloads/art-history-mixed-format/art-history-mixed-format.patch` にある前提です。

## 2. 適用

```bash
cd "$HOME/Desktop/art-history-practice"
git status --short

git apply --check "$HOME/Downloads/art-history-mixed-format/art-history-mixed-format.patch" &&
git apply "$HOME/Downloads/art-history-mixed-format/art-history-mixed-format.patch"
```

何も表示されずにコマンド入力へ戻れば適用成功です。`patch does not apply` 等が出た場合は、ローカルの変更や基準コミットとの差分があるので、そのまま止めます。`--reject`・`--3way`・強制上書きで進めないでください。既存の未コミット変更は削除しません。

## 3. 追加テスト

リポジトリのルートから実行します。追加パッケージやDB接続は不要です。

```bash
node --experimental-strip-types --test frontend/tests/artPracticeFormat.test.ts frontend/tests/artPracticeWiring.test.ts
```

期待値は38 tests / 38 pass / 0 failです。

## 4. アプリ全体の検証

このパッチ作成環境ではNuxt全体のビルドや実ブラウザー操作を実施できていません。公開前に、依存パッケージを導入済みの環境で次を実行してください。Node.jsは既存リポジトリのengines条件を満たすものを使用します（24系を使っている環境なら、その環境で実行）。

```bash
cd frontend
npm test && npm run typecheck && NITRO_PRESET=static npm run generate
cd ..
```

テスト・型チェック・ビルドのどれかで失敗したら、コミット・公開へ進めません。既存の問題や設定に対して、このパッチのテスト結果だけで正常動作を保証することはできません。

ブラウザーでは以下を確認します。

- トップの説明と、サイドバーの2区分。
- 通常問題の資料と図版が欠けず、選択・採点が従来どおり動くこと。
- 活用問題の共通資料と参照ボタン。同じ問題群に複数の小問を登録したデータがある場合、その小問リンクも確認。
- 区分を選んで開始した場合に、その区分の最後で止まること。
- ランダム順、再読み込み、履歴・復習からの表示。
- PCとスマートフォンで、本文・図版・ボタンがはみ出さないこと。

## 5. 変更した11ファイルだけを反映

```bash
git diff --check
git --no-pager diff --stat

git add -- \
  docs/art-mixed-question-format.md \
  frontend/app/components/ExamSidebar.vue \
  frontend/app/components/PracticeMaterials.vue \
  frontend/app/pages/index.vue \
  'frontend/app/pages/practice/[examNumber]/[questionNumber].vue' \
  frontend/app/pages/practice/start.vue \
  frontend/app/utils/artPracticeFormat.ts \
  frontend/app/utils/practiceSequence.ts \
  frontend/tests/artPracticeFormat.test.ts \
  frontend/tests/artPracticeWiring.test.ts \
  frontend/tests/examSidebarLayout.test.ts

git diff --cached --name-only
```

別の作業で既にステージされたファイルがあれば、それも一覧に出ます。その場合は今回の変更と混ぜず、ステージ内容を整理してください。11ファイルだけであることを確認してから、通常のコミット・公開手順へ進みます。

```bash
git commit -m "Support standalone art questions and shared application materials"
git push origin main
```

Netlifyでmainの自動デプロイが設定されていれば、それによってフロントの変更が反映されます。このパッチによるDBマイグレーション、再インポート、Fly.ioの再デプロイは不要です。

## 適用直後に取り消す場合

適用後に同じ箇所をさらに編集していない場合に限り、逆向きに戻せます。

```bash
git apply --reverse --check "$HOME/Downloads/art-history-mixed-format/art-history-mixed-format.patch" &&
git apply --reverse "$HOME/Downloads/art-history-mixed-format/art-history-mixed-format.patch"
```

これは作業ツリーを戻す手順です。コミットやプッシュが済んだ履歴まで自動で戻すものではありません。
