# 実河川モデル・観測断面の追加調査 — 2026-10-12（JST）

HEC-RASモデル、実測横断、標高基準を含むGitHub公開検索8件から、新たに4リポジトリを固定コミットで確認しました。
候補探索に検索結果を使い、採用判断は原リポジトリのREADME・ファイル内容を根拠とします。
これまでのFluvialGeomorph点検に加えた調査です。**採用・実河川試行は0件のままです。**

| 一次資料・固定コミット | 確認した内容 | 保留・除外理由 |
|---|---|---|
| [NOAA-OWP/ras2fim](https://github.com/NOAA-OWP/ras2fim/tree/bc1f00fdccbd2588e42284f90abcb0afbfa2daef) | 位置情報を持つ1D HEC-RAS氾濫モデルを使う。12090301のサンプルは外部ESIP S3に置かれ、READMEの取得手順は発行された認証情報を要求 | GitHubには対象モデルの横断を確認できない。外部データの利用条件・単位/基準高・原測量は未確認。コードのApache-2.0を外部データに転用しない |
| [larflows/PyRASFile](https://github.com/larflows/PyRASFile/tree/92923a294cbfd874cfda56d419c8d658fe831c67) | 流量条件・結果ファイルを扱うPython補助コード | ツリーに河川形状や実測横断データがないため、データ候補から除外 |
| [psu-efd/pyHMT2D](https://github.com/psu-efd/pyHMT2D/tree/57645ff7af3321a54998f9acb29aa4281380f8e8) | Muncie2Dの形状/プロジェクトファイルがツリーにある。READMEはHEC-RAS例題由来をpublic domainと説明する一方、元所有者の明示許可なしの再利用を禁止する注意も記載 | 元配布物に適用する条件を確認してから利用する。注意確認後に形状ファイルを取得・再利用していない。主に2Dモデルであり、1D用実測横断として扱わない |
| [localdevices/pyorc](https://github.com/localdevices/pyorc/tree/3fa6bfbc5b61af5e2a881a5796366eaf74cf2f6e) | Zambia・LusakaのNgwerere川、Zambezi Road crossingの作例。実測XYZ横断CSVを2ファイル取得 | データに適用する利用条件と測量日・高さ単位の原仕様・流下方向・計算条件を確認する。横断2本を異なる2件の試行として数えない |

## Ngwerereの取得物

| ファイル | 点数 | bytes | SHA-256 |
|---|---:|---:|---|
| `examples/ngwerere/ngwerere_cross_section.csv` | 27 | 826 | `6b17f9f2bb4c87566c675b9d12c7fa9f4a153864abefb013db69203ae52b9925` |
| `examples/ngwerere/ngwerere_cross_section_2.csv` | 25 | 750 | `2eca8d29f8198feb2e25ca07f145e73d38cf33c6b3e3a34408bf58b8570ad8a3` |

CSVのヘッダーは`x,y,z`、単位欄はありません。
原チュートリアル`04_Extracting_crosssection_velocities_and_discharge.ipynb`は、
両断面が計測水位と同じ鉛直基準で測定されたと明記しています。
`ngwerere.json`には水平EPSG:32735（WGS 84 / UTM zone 35S、m）、
水位参照パラメータ`h_ref=0`、`z_0=1182.2`があります。
水平CRSのmをZの単位確認の代わりにせず、元の鉛直基準・測量仕様は未確認として記録します。
チュートリアルの共通基準の説明は、既存候補にない有用な確認事項です。

`ngwerere_20191103.mp4`の名前を横断測量日の証拠とはしません。
READMEのAGPL-3.0はソフトウェアの説明で、原観測データの帰属・利用条件の確認は完了していません。
橋付近の断面なので、流下方向・断面間隔・構造物損失も対象区間選定時に確認する必要があります。
流量・粗度・境界条件を推測して実河川の計算成功を作ることはしません。

取得資料は`.local/research/public-data/round7/`、固定コミット・ファイルサイズ・SHA-256・保留理由は
[候補台帳](public-data-candidates.json)に保存しました。外部のデータやコードを製品に配布していません。
次は公開原資料で利用条件と測量仕様を追跡し、揃った候補だけを取込み・計算・施工比較の試行へ進めます。

## カメラ測量原資料の追加確認

同じ固定コミットの`01_Camera_Configuration_single_video.ipynb`は、GCPと水位`z_0`を
RTK GPSで測り、横断河床も同じ楕円体高の基準で測定したと説明しています。
これは共通鉛直基準の新しい一次資料です。作者は「EPSG 32735 ellipsoid vertical reference」と
記述していますが、EPSG:32735自体は2D水平CRSなので、鉛直系を指定するEPSG番号とは扱いません。
原観測の測地実現・Z単位/機器設定などの測量記録は未取得です。
また、ローカル水位のゼロは単一動画の例題用の設定で、独立した標尺原点や境界水深ではありません。

同梱の`cross_section1.geojson`（27点）と`cross_section2.geojson`（25点）は
CRS84の経緯度に同じZ値を持ちます。GDAL 3.10.3で経緯度→EPSG:32735の**水平変換だけ**を行い、
CSVのXYと元順序で照合した最大差は約1.04×10⁻⁹m／9.39×10⁻¹⁰m、
保存Z値の差は両断面とも0でした。高さの変換は行っていません。
同じ52点の別形式が整合することを確認しただけで、独立観測や位置精度の検証ではありません。

原文7ファイルのSHA-256と照合記録は候補台帳および`.local/research/public-data/round8/`に保存。
Ngwerereを名指す追加公開検索は、原データの独立した利用許諾や流下条件を確定する資料には
つながりませんでした。利用条件・測量日・流下方向・区間条件の不足が残り、採用は0件です。
