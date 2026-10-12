# READMEの実画面GIF

`docs/assets/` の15本は、同梱の合成サンプルをChromiumで実際に操作して撮影しています。
冒頭の総集編1本、紹介用Hero 6本、詳しい操作8本をREADMEへ掲載します。
描画済みの画面状態を撮影し、読み取れる時間を確保してループGIFにします。
Heroでは実画面のPNGに紹介用の見出し・フレームを添えています。数値・図・UI要素は
元のスクリーンショットを使用し、描き替えや架空の結果の追加は行っていません。
撮影日時は実際の実行日時です。
数値精度の検証は [validation](validation.md) を参照してください。

## 再生成

開発依存関係、Chromium、FFmpegが必要です。撮影には**専用の新規SQLiteパス**を指定し、
既存プロジェクトのデータベースは使わないでください。撮影操作により計算・感度比較・測点間隔比較の履歴が作られます。

3つのターミナルで次を実行します。ポートが使用中ならAPI・Web・撮影URLを一緒に変更します。

```sh
# 1: 専用API。再撮影時は別の新規DB名に変更する
API_BIND=127.0.0.1:3201 DATABASE_PATH=.local/readme-demo.sqlite \
  bash scripts/run-cargo.sh run --locked -p doboku-api
```

```sh
# 2: 専用Web
API_PROXY=http://127.0.0.1:3201 npm run dev --prefix apps/web -- --port 5373 --strictPort
```

```sh
# 3: Hero 6本と総集編。Playwright管理のChromiumを使う場合はCHROMIUM_PATHを省略する
CHROMIUM_PATH=/usr/bin/chromium node scripts/capture-heroes.mjs http://127.0.0.1:5373

# 詳しい操作8本を撮り直す場合
CHROMIUM_PATH=/usr/bin/chromium node scripts/capture-readme.mjs http://127.0.0.1:5373
```

Heroは1440×1100 pxのアプリをデバイス倍率2で描画し、実際の図やパネルを撮影。
文字の解像度を保って1600×1000 pxの紹介フレームに配置します。
GIFは1280×800 px・6 fps・無限ループで書き出します。元PNG、保存結果HTML、フレーム一覧、
撮影日時・コードのコミットは `.local/hero-capture/` に記録します。
3Dは実際のスクロールで拡大し、マウスドラッグで8つの視点を撮影。
WebGLコンテキストの有効性も確認します。
撮影専用にChromiumのソフトウェアWebGLを有効にしています。製品の3Dコードは変更していません。
Heroの見出し・色・レイアウト・撮影対象は `scripts/capture-heroes.mjs` で管理します。

操作デモは1440×1000 pxで撮影し、GIFは1200 px幅・4 fps・無限ループで書き出します。
1本だけ更新する場合は対応するスクリプトのURLの次に名前を指定できます。
Hero例: `hero-construction`。操作例: `station-spacing`。
Heroを個別更新した場合、総集編は更新しません。総集編も更新する場合はHero全体を再生成します。
操作デモの生成元PNG・HTML・フレーム一覧は `.local/readme-capture/` に保存します。
これらの撮影元ファイルはGitには含めません。
公開対象はGIF、撮影スクリプトとこの文書です。撮影後は専用API/WebをCtrl-Cで終了します。

## Hero gallery

| GIF | 実際の操作・表示 |
|---|---|
| `hero.gif` | 以下6本の冒頭・終盤をつないだ総集編 |
| `hero-river.gif` | ダッシュボードの水面形、水位/水深/流速の切替 |
| `hero-editor.gif` | 底幅20→28 m、法勾配1.5→2、矩形への変更と実プレビュー |
| `hero-construction.gif` | 0.5/1 m掘削の再計算、中央測点の横断、水位差・概算土量 |
| `hero-assistant.gif` | 日本語入力、粗度変更提案の確認、Rust再計算、比較図。ローカル操作ルールを使用 |
| `hero-reports.gif` | 保存結果HTMLの縦断/横断、流量感度、元測点の間隔比較 |
| `hero-spatial.gif` | 3D断面を実際にドラッグして回転。鉛直3倍・縦断0.15倍の参考表示 |

## 詳しい操作

| GIF | 実際の操作 |
|---|---|
| `workflow.gif` | ダッシュボード、断面編集、縦断図、施工横断図、流量比較、アシスタント（従来の `hero.gif` を改名） |
| `cross-section.gif` | 底幅・法勾配の変更、全測点反映、矩形/台形切替 |
| `water-profile.gif` | 水位/水深/流速切替、測点別横断図 |
| `construction.gif` | 0.5 m/1 m掘削を再計算し、水位・土量・横断形状を確認 |
| `sensitivity.gif` | 流量/粗度比較、SQLite履歴、実際のHTMLレポート |
| `ai-assistant.gif` | キー不要のローカル提案、確認、Rust再計算、比較図 |
| `station-spacing.gif` | 補間の前提確認、2/4分割、元測点の水位差・数値比較、再読込み後の履歴・実際のHTML |
| `survey-provenance.gif` | 合成CSVの出典記録、未確認項目、プレビュー/確認、実際の保存結果HTML |
