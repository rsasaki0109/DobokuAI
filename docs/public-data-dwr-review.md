# California DWR候補と50%の残る条件 — 2026-10-12（JST）

公開データでの到達可能性を追加調査しました。**実河川の採用・試行は0件、成熟度は44.0点のままです。**
3件の異なる対応可能区間と対象コミットのホストCIが、引き続き50%の必須条件です。

## 新しい候補

一次リポジトリ [cfbrush/cv-stream-rating-data](https://github.com/cfbrush/cv-stream-rating-data/tree/2c34575d109b055a7dd38409a0c74de56dc18bec)
のREADME、`DATA_LICENSE.md`、取得スクリプト、保存済みカタログ、索引とDSM2横断表を確認しました。
集約CSV/JSON等はCC BY 4.0と説明され、帰属はBrush, C.F. / Hydrolytics LLCです。
原データの条件も適用すると明記されています。コードのMITをデータに転用しません。
保存済みカタログは別配布者のコピーとして扱い、原カタログとの直接照合は未完了です。

### DSM2のNAVD88横断

原データセットは [CSDP NAVD88 Update](https://data.cnra.ca.gov/dataset/cross-section-development-program-navd88-update)。
保存済みカタログには`license_id=cc-by`と「DSM2がNAVD88を採用」の説明があります。
集約側の取得スクリプトは水平NAD83 / UTM zone 10Nと、高さUS Survey Feetを説明します。
原ファイル・マニュアルとの単位確認は未完了です。高さを水平単位から推定しません。

横断表には10,680行、470個のchannel_id、`xs_index=0`の行が1,179あります。
列は`channel_id,xs_index,station_ft,elevation_ft`です。
取得スクリプトでは`xs_index`を**各横断ブロック内の点番号**としてリセットします。
これを縦断測点、断面ID、断面間距離として読んではいけません。
表だけでは一意な横断ブロックIDや流下位置が記録されておらず、元のネットワーク形式との照合が必要です。
470チャネルや1,179個のゼロ行を、採用した河川数・検証済み断面数として数えません。

READMEはDelta専用・2009年校正のデータと説明しています。
潮汐・逆流・非定常・分岐/合流の影響を無視して1D定常の適合を宣言しません。
流下方向・横断位置/間隔・堤岸・対応可能な区間・流量/粗度・境界条件の根拠が必要です。
取込み、単位変換、計算は実施していません。

### NCRO測深の3候補

初回は8 MiBの取得上限を超えたため全量を保存せず、**先頭16,384 bytesだけ**を点検しました。
この部分点検を全体の件数・整合性・ハッシュや測量品質の検証とは扱いません。後続の全量点検は下記です。
列にはXYZ・出典・測量開始/終了日・機器種別・Survey_Reportがありますが、
先頭記録には座標単位・鉛直基準の指定がなく、Survey_Reportも空欄です。

| ファイル名 | 先頭記録の確認事項 |
|---|---|
| `20230214-elkslough` | NCRO、Singlebeam、測量期間2023-01-26〜02-14。共通基準高・単位は未確認 |
| `20230720-middleriversouth` | 内部の日付は2023-07-13〜07-18、機器はMultibeam、Feature_Class_Name末尾は`_SB`。ファイル名だけで日付/測量方式を決めない |
| `20240123-sacramentoriver` | 内部Feature_Class_NameはGrantLine / FabianBell Canal。ファイル名だけでSacramento Riverの区間と確定しない |

索引も異なる河川・測量年/方式の行を同じ取得URLへ対応付けています。
この対応付けを原測量の同一性の証拠として使いません。カタログ・原サービス・測量報告で照合が必要です。
3ファイルが存在することだけで、異なる実河川3件の達成条件を満たしたとはしません。

### 全量点検と再実行手順

同じ固定コミットから3ファイル全体（計81,918,330 bytes）を取得し、
`scripts/inspect-ncro-survey.py`で全355,484行を点検しました。

| 候補 | 行数 / 有限XYZ行数 | bytes | 同じ取得URLを持つ索引行 / feature名の一致 |
|---|---:|---:|---:|
| Elk Slough | 120,114 / 120,114 | 23,374,338 | 2 / 0 |
| Middle River South | 121,501 / 121,501 | 23,981,905 | 2 / 0 |
| Sacramentoというファイル名の候補 | 113,869 / 113,869 | 34,562,087 | 9 / 0 |

全ファイルでXYZは数値かつ有限、CSV構文と列数は正常でした。
地物名・測量方式・測量日・開始/終了日は、各ファイル内でそれぞれ1種類でした。
全行でSurvey_Reportは空欄です。各ヘッダー先頭の`ï»¿`の文字化けを記録し、原CSVは修正していません。
索引のfeature名との比較は、URL末尾の名前を取り出して大小文字を無視した文字列一致だけです。
一致0件を「別の場所」と断定せず、原サービスで照合する必要がある対応付けとして記録します。
名称・日付・機器の差が必ず原測量の誤りを意味するわけではありません。

点検ツールはPython 3.11以上の標準ライブラリのみを使用します。取得済みの完全なファイルを指定します。

```bash
python3 scripts/inspect-ncro-survey.py \
  --csv /path/to/complete-survey.csv \
  --index /path/to/complete-index.csv \
  --resource-url 'https://gis.data.cnra.ca.gov/api/download/v1/items/8e350b44bc8b449b82b8260dccc770a7/csv?layers=84' \
  --output /path/to/new-inspection.json
python3 tests/test_ncro_inspection.py
```

`--index`と`--resource-url`は省略できます。指定時はURLを完全一致で照合し、
そのURLが示す索引の全記録を元CSVのfeature名と比較します。索引もSHA-256を記録します。
行末までの構文・XYZ・日付の暦日部分を点検し、全ファイルのSHA-256、元単位の範囲、
メタデータの出現数、問題件数と最初の20件のCSV行番号をJSONへ出力します。
メタデータ値は各項目で出現数の多い20種類まで表示し、未表示の種類数も記録します。
構文エラー時は`parse_complete=false`とし、途中までの件数を全件成功として扱いません。
終了コード0は点検完了であってデータ採用ではありません。XYZ欠損/非有限値・構文エラー等は2、
日時/ヘッダー等の指摘はJSONで確認します。既存レポートへの上書きは拒否します。
座標/高さの変換、補正、並べ替え、横断抽出、計算、プロジェクト変更は行いません。

5件の合成テストで、先頭16 KiBより後の非有限値検出、取得URLの重複対応、
日付欄の別名/逆順と文字化け、CSV構文/列数エラー、拒否レポート保存/上書き防止を確認。
CIの`scripts/check.sh`にも点検テストを追加しました。ホストCIの成功は引き続き未確認です。
数値が有限なことだけでは、原測量の正確さ、利用条件、共通基準高、堤岸を含む横断や
1D定常区間への適合は確認できません。3件の取込み・計算・採用は未実施です。

## 通信とCIの確認

対象コミット`17d8683ac15f0df3dad960b119ec7b37e70955bd`のGitHub公開コミットページと
Actionsページは404でした。公開状態・CI成功の証拠にはなりません。
認証されたGit操作の成功から公開状態やCIを推定しません。
`api.github.com`の許可追加は既存の下書きに保存されていますが、稼働環境には反映されていません。

原カタログへの読み取りGETはプロキシ接続で403となりました。
必要な追加通信先は`www.sciencebase.gov`、`data.ca.gov`、`data.cnra.ca.gov`です。
NCRO原サービスの照合には`gis.data.cnra.ca.gov`等の元サービスホストも必要です。
今回、下書き読取り機能で既存設定を確認できたため、`api.github.com`と既存の2地理情報ホストを保持し、
上の4ホストに`utility.arcgis.com`、`gis.water.ca.gov`を加えた6通信先を保存しました。
下書き保存は確認済みですが、稼働環境には未適用です。
環境設定で下書きを確認・保存し、環境を公開/適用できた後に原資料・CIの確認を再開します。
通信が開通すること自体はデータ採用や50%の達成ではありません。

## 記録

### 原開発者のCSDP資料による追加照合

[CADWRDeltaModeling/csdp](https://github.com/CADWRDeltaModeling/csdp/tree/3c9882c210c9945ad10c8707017c323afb7d5698)
の作者論文原稿と10個の原入出力/座標クラスを固定版で確認しました。
論文は実測/DEMを参照し、手動/自動でモデル横断を作ると説明します。
モデル横断の全頂点が原観測そのものだと決めず、抽出・編集履歴の確認が必要です。

`NetworkAsciiInput.java`は横断点列の後で`distAlongCenterline`と`xsectLineLength`を読込み、
`NetworkAsciiOutput.java`も位置・長さ・横断メタデータを出力します。
したがって、欠けている縦断位置情報を元ネットワークファイルから照合できる可能性があります。
集約スクリプトはこの後続情報をCSVへ書いていません。流下方向や実測の間隔はまだ未確認です。

元形式にはHorizontalDatum/Zone/Units、VerticalDatum/Unitsの記録があり、
`CsdpFileMetadata`はMeters/USSurveyFeet、NGVD29/NAVD88等を区別します。
一方、未記録の古い形式ではUTM NAD27・zone 10・水平m・鉛直NGVD29/US Survey Feetを既定とする処理があります。
これを2009年NAVD88データやNCROの実際の座標系の証拠に転用しません。
読み込んだネットワークを測深側の基準へ変換する処理もあり、元ファイルと変換履歴の保存が必要です。
原プログラムの内部アクセサ名だけで実データの単位を断定しません。

この照合を受け、DobokuAIには[明示的なCSV単位換算](survey-import.md)を追加しました。
国際ftとUS Survey Footを区別し、選択単位とCSVヘッダーの一致を要求します。
原データのメタデータ確認・取込み・採用が完了したとは扱いません。

資料は`.local/research/goal50/dwr-primary-20261012/`に保管。
作者論文・10クラスの固定URL/bytes/SHA-256は[候補台帳](public-data-candidates.json)へ記録。
プログラムやデータを製品に同梱しておらず、コードのライセンスを原測量の利用条件に転用しません。

取得説明・カタログ・横断表・部分CSV点検は`.local/research/goal50/`に保管。
完全な3CSV・取得記録・全量点検JSONは`.local/research/goal50/full-20261012/`に保管。
全体SHA-256と部分SHA-256を分けて[候補台帳](public-data-candidates.json)へ記録しています。
第三者のデータ/コードはDobokuAIに同梱していません。
追加で確認した`byuill/RAS`の横断マニフェストは、XYと距離を持ちますが河床標高を含みません。
READMEの合成デモや別途必要な実案件ファイルを、実河川の採用実績として扱いません。
