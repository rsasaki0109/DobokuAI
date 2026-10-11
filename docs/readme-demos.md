# READMEの実画面GIF

`docs/assets/` の8本は、同梱の合成サンプルをChromiumで実際に操作して撮影しています。
描画済みの画面状態を撮影し、読み取れる時間を確保してループGIFにします。
画面や計算値の合成・差替えは行っていません。撮影日時は実際の実行日時です。
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
# 3: 撮影。Playwright管理のChromiumを使う場合はCHROMIUM_PATHを省略する
CHROMIUM_PATH=/usr/bin/chromium node scripts/capture-readme.mjs http://127.0.0.1:5373
```

画面は1440×1000 pxで撮影し、GIFは1200 px幅・4 fps・無限ループで書き出します。
1本だけ更新する場合はURLの次に名前（例: `station-spacing`）を指定できます。
生成元のPNG・HTML・フレーム一覧は `.local/readme-capture/` に保存し、Gitには含めません。
公開対象はGIF、撮影スクリプトとこの文書です。撮影後は専用API/WebをCtrl-Cで終了します。

| GIF | 実際の操作 |
|---|---|
| `hero.gif` | ダッシュボード、断面編集、縦断図、施工横断図、流量比較、アシスタント |
| `cross-section.gif` | 底幅・法勾配の変更、全測点反映、矩形/台形切替 |
| `water-profile.gif` | 水位/水深/流速切替、測点別横断図 |
| `construction.gif` | 0.5 m/1 m掘削を再計算し、水位・土量・横断形状を確認 |
| `sensitivity.gif` | 流量/粗度比較、SQLite履歴、実際のHTMLレポート |
| `ai-assistant.gif` | キー不要のローカル提案、確認、Rust再計算、比較図 |
| `station-spacing.gif` | 補間の前提確認、2/4分割、元測点の水位差・数値比較、再読込み後の履歴・実際のHTML |
| `survey-provenance.gif` | 合成CSVの出典記録、未確認項目、プレビュー/確認、実際の保存結果HTML |
