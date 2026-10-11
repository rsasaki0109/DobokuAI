# SQLiteバックアップと復元

Python 3.11以上の標準ライブラリのみ使用します。APIが動いているときもSQLiteの
オンラインbackup APIで整合したスナップショットを作り、WALを取りこぼしません。
生の `.sqlite` ファイルだけを稼働中にコピーする方式は使いません。

```sh
mkdir -p .local/backups
python3 scripts/database.py backup --source .local/doboku.sqlite \
  --destination .local/backups/river-20261011.sqlite > .local/backups/river-20261011.json
```

出力JSONにUTC日時・バックアップのSHA-256・プロジェクト/計算履歴/感度履歴の件数を記録。
感度履歴表がない従来DBも復元でき、API起動時に新しい表を追加します。
JSONも保存してください。`integrity_check`、必要なDB表、全保存JSONの構文を検証します。
これは現在のRust型との将来互換性や工学的妥当性の保証ではありません。
保存JSONが巨大な場合は検証に時間がかかります。バックアップ処理自体の上限は30秒です。

復元は**新しいパス**に行います。既存ファイル・シンボリックリンクは上書きせず拒否します。
ハッシュはバックアップ作成時のJSONから転記します。

```sh
python3 scripts/database.py restore --source .local/backups/river-20261011.sqlite \
  --destination .local/restored.sqlite --expected-sha256 <バックアップのSHA-256>
```

復元後、開発APIを停止し、`DATABASE_PATH=.local/restored.sqlite` を指定して起動。
プロジェクトと保存結果を開き、元の条件・日時・数値・レポートを確認します。
元のDBは保持します。保存結果の表示を復旧確認する際に「計算を実行」を押すと
現在版の新しい計算が作られるので、履歴の「保存結果を開く」を使ってください。
APIのバックアップテストは稼働中WAL DBで履歴を作り、バックアップ後に元DBを変更しても
復元先では元の条件と結果が完全一致することを確認します。感度比較の成功結果・失敗理由・日時も確認します。
Pythonテストは既存復元先・壊れたファイル・別製品DBの拒否と後始末を確認します。

Composeは `/data/doboku.sqlite` が `river-data` volumeにあります。例えば新しいバックアップ先を
使用する一時的なPythonコンテナから同じvolumeをマウントしてこのスクリプトを実行します。
volume名はComposeプロジェクト名で変わるので、`docker volume ls` で確認してください。
APIコンテナにはPythonを同梱していません。Compose volumeでの復旧手順の実行は未検証です。
自動世代管理・暗号化・遠隔保管・災害復旧の運用は未実装。
バックアップにはプロジェクト・計算データが含まれるため、保存先の利用権限を管理してください。
