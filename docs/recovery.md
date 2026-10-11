# SQLiteバックアップと復元

Python 3.11以上の標準ライブラリのみ使用します。APIが動いているときもSQLiteの
オンラインbackup APIで整合したスナップショットを作り、WALを取りこぼしません。
生の `.sqlite` ファイルだけを稼働中にコピーする方式は使いません。

```sh
mkdir -p .local/backups
python3 scripts/database.py backup --source .local/doboku.sqlite \
  --destination .local/backups/river-20261011.sqlite > .local/backups/river-20261011.json
```

出力JSONにUTC日時・バックアップのSHA-256・プロジェクト/計算履歴/感度履歴/測点間隔履歴の件数を記録。
感度/測点間隔履歴表がない従来DBも復元でき、API起動時に新しい表を追加します。
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
復元先では元の条件と結果が完全一致することを確認します。感度比較・測点間隔比較の成功結果・
失敗理由・日時も確認し、測点間隔比較のCSV/HTMLは復元前後で同一です。
Pythonテストは既存復元先・壊れたファイル・別製品DBの拒否と後始末を確認します。

Composeは `/data/doboku.sqlite` が `river-data` volumeにあります。例えば新しいバックアップ先を
使用する一時的なPythonコンテナから同じvolumeをマウントしてこのスクリプトを実行します。
volume名はComposeプロジェクト名で変わるので、`docker volume ls` で確認してください。
APIコンテナにはPythonを同梱していません。2026-10-11、専用Composeプロジェクトで、
Python補助コンテナから稼働中のvolumeを読取り専用でマウントし、オンラインバックアップを実行しました。
別の新規volumeへSHA-256を照合して復元し、同じAPIイメージを別ポートで起動。
7プロジェクト・計算履歴6件・感度履歴2件・測点間隔履歴4件について、12件のスナップショットと
24件のCSV/HTMLが復元前後で完全一致しました。バックアップ後の追加は復元先に含まれません。
これは同一エンジン版・合成データによる復旧検証で、将来版への互換性や継続運用の証明ではありません。

補助コンテナでのバックアップ例（Bash、`<確認したvolume名>`と出力名を置換）:

```sh
mkdir -p .local/backups
docker run --rm --user "$(id -u):$(id -g)" \
  --mount "type=volume,src=<確認したvolume名>,dst=/source,readonly" \
  --mount "type=bind,src=$PWD/scripts/database.py,dst=/tool/database.py,readonly" \
  --mount "type=bind,src=$PWD/.local/backups,dst=/backup" \
  python:3.12-slim-bookworm \
  python /tool/database.py backup --source /source/doboku.sqlite \
    --destination /backup/river-new.sqlite > .local/backups/river-new.json
```

復元時は**別の新規volume**を使い、バックアップを読取り専用にマウントして
`restore --source /backup/river-new.sqlite --destination /target/restored.sqlite --expected-sha256 ...` を実行します。
現在のAPIイメージの実行ユーザーはUID/GID 10001です。復元先volumeとDBの所有権を10001にし、
`DATABASE_PATH=/data/restored.sqlite` で起動します。DBだけが読めても、WAL/SHMを作るディレクトリへの
書込み権限がなければ動作しません。元volumeは残し、復元先で保存履歴と成果を確認してください。
補助イメージの取得にはレジストリへのアクセスが必要です。検証で使用した固定digestは
`python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258`。
ローカルの実行記録・元/復元のハッシュは `.local/compose-recovery/` に保存し、配布には含めません。
自動世代管理・暗号化・遠隔保管・災害復旧の運用は未実装。
バックアップにはプロジェクト・計算データが含まれるため、保存先の利用権限を管理してください。
