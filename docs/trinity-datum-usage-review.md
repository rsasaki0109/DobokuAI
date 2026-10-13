# Trinity River：基準高・利用条件の重点確認

2026-10-13 UTC。対象は、USACE公式校正演習の`CalibrationWorkshop`です。
**教育用途の指定は確認できました。共通基準高と、商用・再配布に使える許諾は未確認です。**
実河川検証への採用は0/3、成熟度44.0/100を維持します。

**追加確認：23:23 UTC以降に原配布候補へ接続できました。**
[DWRの2007年原報告](trinity-primary-review.md)はNAVD88・US Survey Footを明記。
教育用ファイルの高水位との対応を一部確認しましたが、形状全体・450 cfs観測・使用許諾は未確定です。
以下の403は、接続復旧前の確認履歴です。

## 確認結果

| 項目 | 原資料で確認できたこと | 現在の判定 |
|---|---|---|
| 対象河川 | 公式演習はカリフォルニア州、Lewiston Lake下流のTrinity Riverと説明 | 確認済み。同名のテキサス州河川を混同しない |
| 高さの基準 | 形状ファイルの`GIS Vertical Datum=`は空欄。アーカイブの全8ファイルで、下記の文字列点検でも名付き基準の根拠は得られず | 未確認。NAVD88・NGVD29・楕円体高を指定しない |
| 河床と観測水位の共通基準 | 公式演習は観測水位への校正を説明するが、基準点・変換・測量仕様の記載を確認できない | 原測量との対応を確認する必要あり |
| 単位 | プロジェクトは`English Units`、演習は流量cfs・勾配ft/ftを記載 | 原測量の高さ単位の実現は未確認。水平単位から高さ単位を推定しない |
| 配布物の用途 | 公式ページと`.prj`がともに「教育用途のみ」と明記 | 教育用原配布物として記録。商用・実務使用・再配布の包括的許諾を確認したとは扱わない |
| ソフトウェア配布方針 | HECのソフトウェアはUSACE外の個人・組織も、利用条件に従い無償で使用可能と記載 | 原測量データの個別利用条件・権利者の証明とは別 |
| 原測量の権利者・出典 | 演習はactual study由来と説明するが、取得資料には原測量報告の書誌・権利者の明示的確認がない | 未確認。TRRP/米国開拓局の候補資料との同一性を確認する必要あり |

## 利用条件の原文

現在の[USACE公式演習ページ](https://www.hec.usace.army.mil/confluence/rasdocs/hgt/latest/tutorials/1d-steady-flow/calibration-of-a-steady-flow-hydraulics-model-workshop-solution)
へ再接続し、HTTP200、112,491 bytes、SHA-256
`6e579080284f8b970e49912c7fdd58e4c071fd04acd0e88697388f0e5ea1c49d`を記録。
本文は次のとおりで、取得済みプロジェクトの説明とも一致します。

> While this data is from an actual study, the model and results of this workshop do not represent current or future conditions of the river system. This data is provided as a teaching example for purposes of instruction only.

「公開ダウンロードできる」「実調査由来」という事実から、使用範囲を広げません。
現在・将来の河川状態を表すモデルとして扱わず、成果や原データを製品へ同梱していません。

[HEC Software Distribution Policy](https://www.hec.usace.army.mil/software/distribution_policy.aspx)
もHTTP200、25,098 bytes、SHA-256
`d3855fd55f2c50cfecdf680ca15011ec7bc931229669a2d685daa6a758722a54`で取得。
対象を明示的に「CEIWR-HEC software」とする方針です。これを原測量データ全体のライセンスに転用しません。
以前に取得した[HEC利用条件](public-data-hec-review.md)も引き続き区別します。

## 基準高の点検範囲

原アーカイブ`Trinity_calibration_original.zip`は340,691 bytes、SHA-256
`7ed3f314635037fb9d4725f774e2d9ed8c7a900bdef8baeb952120206e560cc5`。
ディレクトリ1個を除く全8ファイルの展開バイトに対し、大小文字を無視して
`NAVD`、`NGVD`、`Vertical Datum`、`horizontal datum`、`copyright`、`license`、
`licence`、`instruction`、`survey date`、`survey report`を検索しました。
`.g01`に`Vertical Datum`1件（値は空）、`.prj`に`instruction`1件。
その他の検索語はこの点検では0件でした。各原ファイルのbytes/SHA-256も保存。

これは文字列点検であり、バイナリ出力の完全な意味解釈や、別の原測量資料にも記載がないことの証明ではありません。
高さの大きさ、近隣の地形・水位、現在の測量仕様から、この古い教育用モデルの基準高を推測補正しません。
入力数値の有限性・観測位置の[形式3点検](hec-ras-inspection.md)は、基準高の確認とは別です。

## 追加の原資料探索と接続

| 正規の資料候補・探索 | 実接続・確認結果 | 扱い |
|---|---|---|
| [Trinity River Restoration Program](https://www.trrp.net/) とrobots | HTTPSトンネル403 Forbidden | 本文・規約・測量報告は取得できていない。原モデルの権利者として確定しない |
| [米国開拓局のTrinityページ](https://www.usbr.gov/mp/trinity/) | HTTPSトンネル403 Forbidden | 原資料を取得できていない |
| GitHub APIの公開リポジトリ検索3件 | HTTP502 Bad Gateway | 検索結果0件と解釈しない |
| GitHub公開検索ページ | HTTP200 | 下記2資料のREADMEを追加点検 |
| [ChenliangWuGeo/TrinityRiverMeander](https://github.com/ChenliangWuGeo/TrinityRiverMeander) | READMEはTrinity River, **TX**の蛇行シミュレーションと明記 | 別河川のため、このモデルの測量仕様・利用条件の根拠から除外 |
| [mdscheuerell/TRRP-2026](https://github.com/mdscheuerell/TRRP-2026) | READMEはTRRP向けのstate-space models入門講演と説明 | 当該原測量の基準高・利用条件を確認する資料ではない |

原配布候補への接続を再開できるよう、既存14カスタムドメインを保持し、
`www.trrp.net`と`www.usbr.gov`を加える設定案を保存しました。
保存結果は`status=saved`、`requires_publish=true`。保存は適用・公開や接続成功の証拠ではありません。
環境設定で変更を確認・保存し、環境を公開した後に原資料の取得を再開します。
プロキシやTLS検証は保持し、遮断を迂回していません。

原取得物・接続記録・各メンバーのハッシュは
`.local/research/goal50/trinity-datum-rights-20261013T152156Z/`へ保存。
固定した取得物と確認範囲は[証拠JSON](trinity-datum-usage-evidence.json)に記録します。
アプリコード・計算条件は変更せず、新しい数値計算テストは実施していません。

## 原資料で確認する残る項目

- この`CalibrationWorkshop`の元測量・モデルの報告書、測量日、権利者、使用範囲。
  教育用の検証、社内の製品評価、変換した成果の保存、製品同梱/再配布の可否を区別する。
- 河床と高水位痕跡それぞれの鉛直基準、単位の実現、基準点・標高、使用した変換と版。
- 添付の形状・65観測記録がその原測量と同じ版か。範囲外の観測・下流距離の対応。

資料確認を外部へ送信しておらず、許可・回答を取得したとは扱いません。
これらが確認できるまで、当該データによる実河川検証を完了したと宣言しません。
