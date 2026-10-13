# 成熟度50% — 原資料確認の阻害条件

2026-10-13 12:20 UTC。固定した[50%の必須条件](maturity-goal.md#50の必須達成条件)を再確認。
実河川の検証採用は0/3件、採点44.0/100で、目標は未達です。
都市断面の表示・復元やGIFの追加を、実河川試行として数えません。

## 今回の原配布先確認

| 原配布先 | 実接続の結果 | 判定 |
|---|---|---|
| [USACE HEC-RAS downloads](https://www.hec.usace.army.mil/software/hec-ras/download.aspx) | HTTPSトンネル接続が403 Forbidden | 例題の元配布物・原条件を確認できない。第三者コードの利用条件で代用しない |
| [DWR NCRO bathymetry](https://data.cnra.ca.gov/dataset/ncro-bathymetry) | HTTP403、本文`error code: 1009` | 原カタログの測量仕様・利用条件を確認できない。通信許可追加だけで解消すると断定しない |
| [USGS ScienceBase catalog](https://www.sciencebase.gov/catalog/items?format=json&q=river%20cross%20section%20survey&max=5) | HTTP403、`Just a moment...`の検証ページ | データの検索結果や原メタデータとして扱わない |
| [PyORC README（固定版）](https://github.com/localdevices/pyorc/blob/3fa6bfbc5b61af5e2a881a5796366eaf74cf2f6e/README.md) | HTTP200。現在のmainも前回調査と同じコミット | Ngwerereの保留を解消する新しい測量・利用条件の証拠ではない |

PyORCのREADMEは9,555 bytes、SHA-256
`aff20de6a816706dc9347765a30dce07b5b5dfd3e698f0ee3dfd9ad8e5336e11`。
固定版と現在取得したREADMEのバイト一致を確認しました。
ソフトウェアAGPLの説明を、原観測データの権利者・個別利用条件の独立確認として加点しません。
[以前の測量確認](public-data-model-review.md)に記録した共通基準の説明等は保持し、不足項目を未確認のまま採用しません。
到達可否と取得ハッシュは`.local/research/goal50/primary-check-20261013/`へ保存。
外部測量データの追加配布や数値条件の推測・捏造は行っていません。

## 再開に必要なもの

- 原配布先へのアクセス確保。USACEは`www.hec.usace.army.mil`の通信許可を環境設定で確認する。
  保存済みネットワーク下書きの全体は読めないため、未知の許可リストを置き換えていません。
  DWR/USGSの403は提供元の制限も含む可能性があり、正規の別配布先や原資料の提供が必要になる場合があります。
- 利用条件・出典・水平/高さ単位・共通基準高・対象区間を確認できる異なる実河川データ3件。
  流下方向、流量/粗度の根拠、境界条件、適用範囲を記録した後、取込み→計算→施工/感度比較→
  独立照査→成果→履歴/復旧を実行する。原資料が揃う前に試行完了を宣言しない。

## 完了済みの確認

最新のアプリ実装`30b690d`の[MVP checks](https://github.com/rsasaki0109/DobokuAI/actions/runs/38393406433)は、
2026-10-13 12:20 UTCにrun・validate job・実行workflowの成功を確認。[証拠](hosted-ci-evidence.json)。
この調査はアプリコードを変更しておらず、追加のローカル数値/E2Eテストは実行していません。
合成例・都市モデルの検証とCI成功は保持しますが、不足する実河川の試行証拠を代用しません。
固定基準の50点以上とすべての必須条件を満たすまで、成熟度は44.0点（表示約45%）です。
