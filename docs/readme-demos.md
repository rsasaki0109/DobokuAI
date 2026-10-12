# READMEの実画面GIF

`docs/assets/` の18本は、合成サンプル「青葉川」をChromiumで実際に操作して撮影しています。
3D Hero 4本（冒頭を含む）、2D中心のHero 5本、折りたたみ内の操作/総集編9本を掲載します。
実画面のPNGに紹介用の見出し・フレームを添え、数値や図の描き替えは行っていません。
撮影日時は実際の実行日時です。数値精度の検証は [validation](validation.md) を参照してください。

## 3Dの表示仕様

河床・堤岸を面で描き、表示用の側面を付けて厚みを見せます。水面の形は1D計算水位と
断面の水際位置から生成します。表示モデル、カメラ、断面線、回転、全画面を操作できます。
鉛直3倍・縦断0.15倍。断面間の面と厚みは表示専用で、Rustの計算には使いません。
[モデルと検証](river-3d.md)。動画は3D流体解析の映像ではありません。

## 再生成

開発依存関係、Chromium、FFmpegが必要です。撮影には**専用の新規SQLiteパス**を指定し、
既存プロジェクトのDBは使わないでください。操作デモでは計算・比較の履歴が作られます。
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
# 3: 3D Hero 4本。Playwright管理のChromiumならCHROMIUM_PATHを省略する
CHROMIUM_PATH=/usr/bin/chromium node scripts/capture-river-3d.mjs http://127.0.0.1:5373
```

2D Hero/総集編や詳細操作も撮り直す場合は、次の順序で実行します。
最後の3D撮影が、滑らかな `hero-spatial.gif` と冒頭の `hero.gif` を生成します。

```sh
CHROMIUM_PATH=/usr/bin/chromium node scripts/capture-readme.mjs http://127.0.0.1:5373
CHROMIUM_PATH=/usr/bin/chromium node scripts/capture-heroes.mjs http://127.0.0.1:5373
CHROMIUM_PATH=/usr/bin/chromium node scripts/capture-river-3d.mjs http://127.0.0.1:5373
```

3D撮影は実際のマウスドラッグで32/48枚を撮り、1280×720 px・12 fpsの無限ループにします。
施工前後比較では、同じカメラ経路を繰り返してモデルを切り替えます。
WebGLコンテキストと元フレームの変化も確認します。元PNG、表示元の計算結果JSON、
フレームSHA-256、撮影日時・基底コミットは `.local/hero3d-capture/` に記録します。
基底コミットの記録には撮影時の未コミット変更を含みません。最新版の撮影スクリプトと
3D実装はこのリポジトリに保存します。撮影専用にChromiumのソフトウェアWebGLを有効にしています。

2D Heroは1440×1100 px・デバイス倍率2のアプリから図を撮影し、1600×1000 pxの紹介フレームへ配置。
1280×800 px・6 fpsで出力し、元PNG・HTML・フレーム一覧は `.local/hero-capture/` に記録します。
操作デモは1440×1000 pxの画面を1200 px幅・4 fpsで出力し、元ファイルは `.local/readme-capture/` に保存します。
これらの元ファイルはGitには含めません。公開対象はGIF、撮影スクリプトと文書です。

1本だけ更新する場合は対応するスクリプトのURLの次に名前を指定できます。
3D例: `hero-section-3d`。2D例: `hero-construction`。操作例: `station-spacing`。
2D Heroの個別更新ではワークフロー総集編は更新しません。全体の生成で `hero-workflows.gif` を更新します。
撮影後は専用API/WebをCtrl-Cで終了します。

## 3D Hero

| GIF | 実際の操作・表示 |
|---|---|
| `hero.gif` | 48フレーム。地形・水面の回転、掘削案への切替、断面視点 |
| `hero-spatial.gif` | 48フレーム。施工前の地形と水面を一周するカメラ |
| `hero-construction-3d.gif` | 32フレーム。同じ視点経路で施工前→1 m掘削後。実際の水位差・土量 |
| `hero-section-3d.gif` | 48フレーム。掘削案を正面寄りの視点で回転 |

## 2D Hero

| GIF | 実際の操作・表示 |
|---|---|
| `hero-river.gif` | ダッシュボードの水面形、水位/水深/流速の切替 |
| `hero-editor.gif` | 底幅20→28 m、法勾配1.5→2、矩形への変更と実プレビュー |
| `hero-construction.gif` | 0.5/1 m掘削の再計算、中央測点の横断、水位差・概算土量 |
| `hero-assistant.gif` | 日本語入力、粗度提案の確認、Rust再計算。ローカル操作ルールを使用 |
| `hero-reports.gif` | 保存結果HTMLの縦断/横断、流量感度、元測点の間隔比較 |

## 詳しい操作・総集編

| GIF | 実際の操作 |
|---|---|
| `hero-workflows.gif` | 断面・水面形・施工・AI・レポートの見どころ。保存済みの版には3D改良前の画面を含む |
| `workflow.gif` | ダッシュボード、断面編集、縦断図、施工横断図、流量比較、アシスタント |
| `cross-section.gif` | 底幅・法勾配の変更、全測点反映、矩形/台形切替 |
| `water-profile.gif` | 水位/水深/流速切替、測点別横断図 |
| `construction.gif` | 0.5 m/1 m掘削を再計算し、水位・土量・横断形状を確認 |
| `sensitivity.gif` | 流量/粗度比較、SQLite履歴、実際のHTMLレポート |
| `ai-assistant.gif` | キー不要のローカル提案、確認、Rust再計算、比較図 |
| `station-spacing.gif` | 補間の確認、2/4分割、元測点の水位差、再読込み後の履歴・実際のHTML |
| `survey-provenance.gif` | 合成CSVの出典記録、プレビュー/確認、保存結果HTML |
