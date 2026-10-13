# USACE原配布データの確認 — 2026-10-13 UTC

USACEへの接続が復旧し、公式HEC-RAS例題集と、実調査由来のTrinity River教育用データを取得しました。
**取得と採用は別です。実河川の検証採用は0/3件、成熟度44.0/100を維持します。**
原データ・外部プログラムはDobokuAIに同梱していません。計算・校正も未実施です。

## 取得物と出典

| 原配布物 | bytes | SHA-256 |
|---|---:|---|
| [HEC-RAS 7.0 Example Projects](https://github.com/HydrologicEngineeringCenter/hec-downloads/releases/download/1.0.45/Example_Projects_7_0.zip) | 427,304,097 | `fac04f071e624c841b20e943e3b68f351b4531f565a0c24ab7d885cf9e38d523` |
| [Trinity River校正演習](https://www.hec.usace.army.mil/confluence/rasdocs/hgt/files/latest/233145084/233800105/1/1732742970839/Calibration+of+a+Steady+Flow+Model.zip) | 340,691 | `7ed3f314635037fb9d4725f774e2d9ed8c7a900bdef8baeb952120206e560cc5` |

例題集は[USACE公式ダウンロードページ](https://www.hec.usace.army.mil/software/hec-ras/download.aspx)から案内された配布物です。
例題集全体のサイズとSHA-256を、[公式GitHub release 1.0.45のメタデータ](https://api.github.com/repos/HydrologicEngineeringCenter/hec-downloads/releases/tags/1.0.45)に照合しました。
Trinity添付ファイルは公式演習ページのリンクから取得。SHA-256は取得物の識別用で、独立した発行元チェックサムとの照合ではありません。
例題集は1,126 ZIPエントリ、非圧縮サイズ755,091,768 bytes。全エントリを列挙し、選択したASCIIファイルだけを点検しました。
全例題を解析・検証したとは扱いません。取得記録と選択ファイルのハッシュは[証拠JSON](public-data-hec-evidence.json)へ記録。
原取得物は`.local/research/goal50/reconnect-20261013T133419Z/`に保管しています。

## Trinity River：有望だが採用保留

[公式の校正演習](https://www.hec.usace.army.mil/confluence/rasdocs/hgt/latest/tutorials/1d-steady-flow/calibration-of-a-steady-flow-hydraulics-model-workshop-solution)
は、Lewiston Lake下流、Indian Creek付近からWeaver Creek合流部までの実調査由来と説明します。
ただし、本文とプロジェクトファイルがともに次の制約を明記します。

> This data is provided as a teaching example for purposes of instruction only.

現在・将来の河川状態を表すモデルではありません。教育用の検証候補として記録し、商用利用・実務採用・データ再配布の包括的許諾とは扱いません。
説明は、450 / 4,500 / 7,000 cfsの3イベントと測量した高水位痕跡を記載。
粗度は演習のため主流部を0.02に変更したと説明しており、元の現地校正値とは区別します。

原ファイルのキー・レコードを点検して、次を確認しました。

- `CalibrationWorkshop.prj`は`English Units`。演習本文は流量cfs、勾配ft/ftを明記します。
  原測量の長さ・高さ単位の実現、測量日、水平/鉛直基準の独立確認は未完了です。
- `.g01`は1区間、タイプ1の横断レコード56件。`GIS Datum=`と`GIS Vertical Datum=`は空欄です。
  地理的な位置や標高の大きさから基準高を推定しません。
- `.f01`には観測水位65記録。3列の非空値はそれぞれ51 / 38 / 65個で、異なる河川数ではありません。
- 形状の測点ラベル範囲は92.89〜97.35、観測のラベル範囲は92.98〜112.07。
  46観測記録は形状のラベル範囲外で、19記録は形状のラベルと文字列一致します。
  観測には非ゼロの距離欄を持つ22記録もあるため、ラベル一致だけで観測位置の一致とは扱いません。
  対応付け・範囲選択・原観測基準を確認せずに照査誤差を計算しません。
- 流量指定位置は4か所で、先頭の指定は490 / 4,850 / 7,300。
  演習イベント名の450 / 4,500 / 7,000を全区間の流量として代入しません。
- 各断面は横断方向に4〜12個の粗度レコードを持ち、26個の無効流域ヘッダーがあります。
  DobokuAIの断面ごとの単一粗度・一定流量モデルへ、そのまま変換できません。
- 計画は`Subcritical Flow`、境界には`Up/Dn Type=3`と勾配0.0023が記録されています。
  タイプの正式な意味・境界位置を確認してから使用し、固定水位へ黙って置換しません。

この点検は原テキストの記録数・欄・ハッシュの確認です。断面点の全検証、HEC-RAS実行、DobokuAI取込み、観測への校正は実施していません。
3イベントを3件の実河川試行として数えません。許される用途と共通基準高・原観測との対応、適用可能区間が確認できるまで保留します。

## 7.0例題集の注意

| 選択して点検した原形状 | 原ファイルでの確認 | 保留理由 |
|---|---|---|
| Baxter `.g02` | 横断173、タイプ3が5、タイプ6が2、合流1。水平NAD83、鉛直欄は空 | 構造物・合流・流域条件と原測量の確認が必要 |
| Wailupe `.g01` / `.g02` | 横断47 / 206、後者は`*`付きラベル159。水平NAD27、鉛直欄は空、合流1 | 補間ラベルを独立した原測量と数えず、構造物・合流のない適合区間を確認する |
| Beaver Creek `.g01` | 横断14、タイプ3が1、`*`付きラベル5 | 橋梁例題。原測量・基準高・局所損失を確認する |
| Napa `.g01` | 横断80、タイプ3が4 | 複数橋梁の例題。異なる計画を異なる河川と数えない |
| Critical Creek / Channel Modification | 同じ`Critical Cr.`の形状12断面 | 原測量由来・基準高が未確定。同じ形状の施工案を別河川と数えない |
| Mixed Flow Regime Channel | 19断面、混在流況の例題 | DobokuAIの適用外。単純標準逐次計算で黙って実行しない |

Baxterの`CA_SPCS_III_NAVD88.prj`は、ファイル名にNAVD88を含みますが、本文は水平`PROJCS`のみです。
`Foot_US`は水平単位の記録であり、鉛直基準・高さ単位の証拠に転用しません。
[公式の地理参照例](https://www.hec.usace.army.mil/confluence/rasdocs/rasum/latest/entering-and-editing-geometric-data/example-of-georeferencing-an-hec-ras-model)
も河川網と横断の地理参照を区別しています。

[HEC一般利用条件](https://www.hec.usace.army.mil/software/terms_and_conditions.aspx)と
[HEC-RAS利用条件](https://www.hec.usace.army.mil/confluence/rasdocs/rasum/latest/terms-and-conditions-of-use)は原文を取得しました。
ソフトウェア利用の条件を、各原測量データの権利者・再配布条件の証明には置き換えません。
外部のHECプログラムは実行・変更・組込みしていません。

## 接続と開発環境

USACE原配布ページへの実GETはHTTP200です。環境の観測リストには当該ドメインが載らず、ポリシー状態もunknownなので、全通信設定が反映済みとは断定しません。
既存13カスタムドメインを保持しUSACEを加えた設定案の保存は確認済み。設定案保存と公開・適用は別です。
DWR原カタログは403・`error code: 1009`、USGSは403の検証ページのまま。
CNRAの`sharing/rest/content/items/...`はHTTP200でもHTMLのポータル画面を返し、アイテムJSONとして使えません。
California Open Dataのrobotsは`/api/`を禁止するため、そのAPI探索は行っていません。

再起動後、保存済み開発成果物でAPI/Webを起動し、既存`smoke.py`とViteのAPI転送を確認。
サンプル11断面、固定境界の掘削32,000m³、不正流量422、レポート、確認付きCSV取込み、成功/失敗を区別した感度比較が成功しました。
合成データの機能確認であり、実河川精度の検証ではありません。
`b985d47`の[公開CI](https://github.com/rsasaki0109/DobokuAI/actions/runs/38396997213)のrun・job・実行workflow成功も確認。
この調査ではアプリコードを変更せず、Rust全テストやE2E全件は再実行していません。
