# Trinity原報告：NAVD88・US Survey Footの根拠

2026-10-13 23:23 UTC以降、TRRPの公式ライブラリへ接続できるようになりました。
**DWRの2007年原報告の基準高はNAVD88・US Survey Footと確認できました。**
教育用`CalibrationWorkshop`の高水位記録との対応も一部確認。
ただし、断面形状全体・450 cfs観測の基準高や商用/再配布許諾は未確定で、データ採用0/3・成熟度44.0点を維持します。

**23:45 UTCの追加確認：DOI方針に接続できました。**
[個別資料の例外を含む利用方針、旧測深のGeoid99・基準点、測量年の不一致](trinity-policy-survey-review.md)を記録しました。
以下のDOIの403と設定案は復旧前の履歴です。接続復旧を個別データの利用許諾とは扱いません。

## 原報告の明示事項

[California Department of Water Resources (2007), Trinity River hydraulic flow study: North Fork Trinity to Lewiston Dam](https://www.trrp.net/library/document?id=1407)
をTRRPの正規配布から取得しました。PDFは65,180,962 bytes、SHA-256
`f2b698e6db9b72350d09e305262ff002aa90d01d2385975f76025fd352680863`。

報告本文4ページ（PDFの11ページ）に明記されています。

> The horizontal coordinate system used is the North American Datum of 1983, California State Plane Zone 1 in U.S. Survey Feet (CA83-IF). The vertical datum is the North American Vertical Datum of 1988 (NAVD 88), in U.S. Survey Feet.

これは水平単位からの推定ではなく、**高さの基準・単位を明記した原資料**です。
同報告の形状データは、2001年11月の写真測量と2004年12月の水中LiDARを併合し、TINからGeoRASで横断を抽出したものと説明されています。
一部は2001年モデルの断面を使用。原観測点の単純な集合と同一視せず、地形統合・抽出・編集の履歴を確認する必要があります。
当該モデルのriver milesは古いUSGS地図の里程と同じではないと説明されています。

## 教育用ファイルの高水位記録との照合

同報告の表A-3（4,500 cfs、2005-05-20）とA-4（7,000 cfs、2005-05-11〜13）を、
教育用`.f01`の該当列と照合しました。PDF23ページを画像でも確認し、表A-3の2列群、A-4の3列群を区別。
テキスト抽出した表の記録数はA-3が38、A-4が100、参考としてA-5が99です。

| 教育用プロファイル | 非空水位記録 | 数値の測点ラベルが一致 | 表示丸め幅以内で水位も対応 |
|---|---:|---:|---:|
| 4,500 cfs | 38 | 25 | 25 |
| 7,000 cfs | 65 | 42 | 42 |

閾値は印刷された水位の0.1 ft刻みの半分、**0.05 ft**を照合前に設定し、Decimalで比較。
一致ラベルの記録はすべてこの範囲で、最大差0.05 ftです。
これは出典の対応を調べる比較であり、DobokuAIの計算誤差・現地精度の許容値ではありません。
両者の原数値を換算せず比較しており、教育用ファイルのfeetの実現を独立に証明したものでもありません。
例：ラベル95.03では、4,500 cfsの教育用水位1633.25と表A-3の1633.3、
7,000 cfsの教育用水位1634.43と表A-4の1634.4が対応します。

一致しなかったラベルを移動・丸め直し・補間して一致させていません。
`.f01`の下流距離も保持し、ラベルの一致だけで空間位置の完全一致とは扱いません。
この対応は原報告との関連を裏付けますが、教育用ファイル全体が同じ版・同じ基準であることの証明ではありません。
450 cfsの51観測記録、形状56断面全体、教育用に変更された粗度の確認は別に必要です。
原ファイル・基準高設定・粗度・境界条件は変更していません。

## 別年の測深報告

[Graham Matthews and Associates (2012), 2010–2012 Trinity River bathymetric mapping](https://www.trrp.net/library/document?id=1812)
も取得。10,852,107 bytes、SHA-256
`cddcb8f0fc7ecf7992ce7098defe2eb0af9d544fe9e64116a8d1daffd635111a`。
Geodetic Control節・Table 1は水平NAD83 / California Zone 1とNAVD88の基準点標高を記載。
これは2010〜2012年の別の測量です。古い教育用モデルの基準点・単位・日付の代用にしません。

2025年の1D HEC-RAS報告も公式書誌を取得しましたが、本文PDF配信はHTTP500で未取得。
書誌は2022年測深を使う900超の断面と説明するため、教育用56断面と同じデータとして扱いません。

## 利用条件

TRRPページは「The TRRP website follows the intent of the DOI disclaimer」と明記し、DOIの原方針へリンクします。
初回確認では、そのリンク`https://www.doi.gov/disclaimer.cfm`はプロキシのトンネル403で、本文を取得できませんでした。
既存16ドメインを保持し、`www.doi.gov`を追加する設定案を保存しました。
保存は適用・公開と別です。23:45 UTCの再接続では正規の`/disclaimer`へリダイレクトしHTTP200。
そこからリンクされたCopyright方針も取得しました。今回、追加設定案の再保存はしていません。

米国開拓局の[Disclaimer](https://www.usbr.gov/main/disclaimer.html)と
[Notices](https://www.usbr.gov/main/notices.html)は正規リンクから取得しました。
確認範囲では、当該原測量に対する包括的な商用・再配布許諾は確認できません。
DWR報告が無償入手できること、政府機関のサイトに掲載されていること、PDFに著作権文言が見つからないことを、
原データの包括的許諾へ置き換えません。原報告はDWR、地形統合にはUSBR・Woolpert等が関与しており、原データの権利と対象範囲の確認が必要です。
教育用配布物の「instruction only」という[確認済みの用途指定](trinity-datum-usage-review.md)は保持します。

## 接続・証拠・残る条件

TRRPホーム・ライブラリ・DataPort・robotsとUSBRホーム・robotsへHTTP200で到達。
以前のUSBR`/mp/trinity/`は、現在はトンネル遮断ではなくHTTP404です。
TRRPライブラリ画面の公開JavaScriptが使う読み取り検索で、HEC-RAS文献5件・hydraulic文献47件を確認。
HEC-RASデータ検索とdatum文献検索は当該検索条件で0件でした。サイト全体にデータや基準高の資料がないとは解釈しません。
robotsの禁止対象に相当する地図ページは、大文字/小文字の別URLでも取得せず、公開ライブラリから調査しました。

取得物・PDF・ページ画像・観測対応の詳細は`.local/research/goal50/trinity-primary-20261013T232340Z/`へ保管。
[確認した取得物と範囲](trinity-primary-evidence.json)にURL・bytes・ハッシュ・対応件数を記録。
PDFのハッシュは取得版の識別であり、独立した発行元チェックサムとの照合ではありません。
原報告や測量ファイルを製品に同梱していません。

次に必要なのは、DOI/TRRPのデータ利用条件、教育用形状・450 cfs水位の元版との対応、
使用できる対象区間・条件の確認です。資料の取得を実河川の計算・施工比較・独立照査の完了として数えません。
今回の作業は原資料の読取り・照合で、数値エンジンの計算・新しい水理テストは実施していません。
