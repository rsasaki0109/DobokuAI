# GitHub公開の準備 — 2026-10-12（JST）

ユーザーが公開対象をGitHubリポジトリと指定しました。
Webサイトの公開・OSSライセンスの付与とは別の操作です。
[利用条件の現状](../NOTICE.md)をREADMEでも明示しています。
現時点では公開設定の変更を確認できていません。

## 公開対象を確認した範囲

- `c355da4`までの到達可能な全9コミットと作業中の変更を確認。
- 履歴の187テキストblobと作業ツリー120テキストファイルで、秘密鍵、GitHubトークン、
  AWSアクセスキー、既知のProviderキー、認証情報付きURLの形式検査に該当なし。
- `.env.example`は追跡対象、`.env`、SQLite、`.local`、取得した調査データ、テスト成果は追跡対象外。
- 配布画像は作成したUI/架空モデルのデモ。現地測量・実施設の写真やモデルとして説明していない。
- 形式検査は秘密情報・権利問題が存在しないことを保証するものではない。
  `.local/publication-audit.json`に実行時の件数・対象・制約を記録。

GitのHTTPS認証で読み取りは成功しました。
GitHub CLI用の既存変数は存在しますが、値を表示・抽出せずそのまま使います。
`api.github.com`は通信制限の403で遮断され、リポジトリの可視性APIを取得できませんでした。
Gitアクセス成功や匿名HTTPの404だけから、public/private・管理権限・CI成功を断定しません。

## 公開設定

追加の認証トークンを依頼する前に、既存認証で対象APIへ接続できることを確認します。
既存の`geospatial.jp`/`www.geospatial.jp`を残し、`api.github.com`を環境設定の許可先下書きに追加しました。
下書き保存だけでは稼働環境へ適用されません。環境設定で確認・保存して環境をPublish後に再確認します。

管理者がGitHubから直接変更する場合は、[Repository Settings](https://github.com/rsasaki0109/DobokuAI/settings)の
General → Danger Zone → Change repository visibility → Make public を使えます。
既にpublicなら変更は不要です。公開後はAPIの`private:false`かGitHub上のPublic表示で確認します。
公開設定の変更はコミットのpushと別です。公開設定の確認ができるまでは完了と記録しません。
