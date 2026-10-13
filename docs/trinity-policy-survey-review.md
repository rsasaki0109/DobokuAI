# Trinity：DOI利用方針と旧測深報告の追加確認

2026-10-13 23:45 UTC以降にDOIの公式方針へHTTP200で到達しました。
前回の接続403は解消しましたが、**教育用モデル全体の共通基準高と商用・再配布許諾は未確定**です。
実河川採用0/3・成熟度44.0/100を維持します。

## DOIが明示する利用条件

TRRPがリンクする[Disclaimer of Liability and Endorsement](https://www.doi.gov/disclaimer.cfm)
は正規の`/disclaimer`へリダイレクトします。内容は正確性・完全性・適合性等の保証をしないことと、
製品や企業への言及が推奨を意味しないことです。データの包括的な使用許諾ではありません。

そこからリンクされた[Copyright, Restrictions, and Permissions](https://www.doi.gov/copyright)
も取得しました。Copyright節は次を明記します。

> Generally, materials produced by federal agencies are in the public domain and may be reproduced without permission. However, not all materials appearing on this web site are in the public domain. Some materials have been donated or obtained from individuals or organizations and may be subject to restrictions on use.

連邦機関作成物の一般原則と、外部から提供・取得した資料の例外を区別しています。
個別資料の著作権状態は保証しないとも明記。Linking to Interior Websites節は、最新版を見られるよう、
別サーバーに掲載部分を複製するより元サイトへのリンクを求めています。

Trinityの地形には州機関DWR、USBR、Fugro、Woolpert等が関与しています。
政府サイトで配布されることだけでは、原測量の作成主体・権利帰属・個別条件は確定しません。
TRRPがDOI方針の趣旨に従う旨も、掲載する全測量を連邦機関作成物とする証明ではありません。
当該教育用配布物に明示された「instruction only」は保持します。
この確認では、測量データの商用利用・再配布・現在の設計への利用を許可済みとは扱いません。

## 2005年測深評価報告で確認した基準

[USBR (2005), Airborne LiDAR (subsurface bathymetric) evaluation](https://www.trrp.net/library/document?id=395)
を公式配布から取得しました。PDFは2,692,529 bytes、SHA-256
`73f772691eeb0ddba1c59058f169ce68d5f9d904b3a0128906aeda72a12c9694`。
2005年はライブラリの書誌年です。本文は2004年12月の取得活動を記載します。

印刷・PDFとも4ページ、Data Acquisition (Fugro)節に明示されています。

> Vertical Datum – NAVD88 with units of US Survey Feet. Conversion from NAD83 ellipsoid elevations to NAVD88 used the Geoid99 model.

同ページはFugro報告`FP6254.002`を出典とし、NAD83 / California State Plane Zone 1 / US Survey Foot、
基準点HPGN 02 JD（NGS PID AC8625）・LEW1（LEWIS1）を説明します。
これは記載された測量の基準です。Geoid99を現在のデータや教育用56断面へ自動適用していません。
基準点の座標・実現・変換履歴の詳細を独立に検証したものでもありません。

この報告の印刷・PDF18ページには、測深データをDesign Level Dataと混同せず、
設計要件を満たすため地上測量が必要だと明記されています。
3ページには、水中の等高線はLiDARの不足により1 ft等高線の基準を満たさない旨も記載。
これらを消して「実務設計にそのまま使用可能」と説明しません。

## 関連報告の測量年の不一致

[Hilldale and Raff (2006), Assessing the ability of airborne LiDAR bathymetry to map shallow river channel geometry](https://www.trrp.net/library/document?id=397)
も取得しました。PDFは1,000,924 bytes、SHA-256
`a8c13a7cbfba9bb3e4ec52680f803e4dbf2c77de0b6666fe9422c09cf168ce59`。
[DWR 2007年報告](trinity-primary-review.md)が参照するタイトルに対応しますが、これだけで同じ取得版・原点群とは断定しません。

| 原資料 | 記載場所 | Trinityの測量時期の原文記載 |
|---|---|---|
| USBR 2005評価報告 | 3・7ページ | Dec 2004 Lidar Flights、Dec 1, 2004の到着、Dec 5, 2004の燃料車 |
| DWR 2007水理報告 | 本文3ページ / PDF10ページ | December 2004 LiDAR bathymetry |
| Hilldale and Raff 2006評価 | 6ページ | Trinity River ALB survey took place in December 2005 |

2006報告の7ページはTrinityの地上測量をNAD83・NAVD88と記載します。
6ページにあるYakimaの同名基準をTrinityの根拠へ流用していません。
測量年の違いが別取得・版の違い・誤記のいずれかは未解決です。原文を書き換えず、不一致として残します。
2006報告は正の偏りや水深による誤差の傾向も検討しています。一般的な補正推奨を、教育用断面の標高補正値に転用していません。

## 450 cfs観測と採用に残る条件

公式ライブラリの文献検索を、既存画面の公開検索インターフェースで実施しました。
Flood Plain Infrastructureは1件、Airborne LiDARは8件、450は15件、Spring Flow Eventsは9件。
該当する旧測深報告2件を精読しましたが、この確認から450 cfsの51水位記録と同一の原観測表・測量日・基準点は確定できませんでした。
2005年のFlood Plain Infrastructure Modifications Spring Flow Eventsという参照タイトルも、今回の結果では同定していません。
検索結果は当該語・文献区分の範囲です。原資料がサイト全体に存在しないとは結論しません。

次に必要なのは、教育用断面の元モデル版との対応、450 cfs原観測表の対応、原測量の個別利用条件です。
その後も4流量変更位置・粗度の指定方式・無効流域を保持し、エンジンで扱える区間と境界条件を選定する必要があります。
DOIの接続復旧や関連資料の基準高確認を、数値計算・実河川校正・施工比較の完了として数えません。

## 証拠と検証範囲

[取得・確認記録](trinity-policy-survey-evidence.json)にURL・UTC日時・bytes・SHA-256・適用範囲を記録。
原ファイルは`.local/research/goal50/trinity-followup-20261013T234524Z/`へ保管し、再配布していません。
2005報告4・18ページ、2006報告6ページは画像でも確認しました。
PDF抽出・描画は完了しましたが、描画時に非致命的なFontconfigキャッシュ警告とPDF設定警告が出ています。
ハッシュは取得版の識別であり、発行元が別に公表したチェックサムとの照合ではありません。
ネットワーク設定の保存・公開状況は、今回のHTTP200という実接続の証拠と区別します。
今回は原資料調査と記録の更新のみで、アプリやエンジンを変更・再計算していません。
