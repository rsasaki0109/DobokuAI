import type { DatasetProvenance } from './types';

export const emptyDataset = (): DatasetProvenance => ({
  data_kind: 'unspecified', source_url: '', attribution: '', usage_terms: '', survey_date: '', processing: '',
});

export function DatasetFields({ value, change }: { value: DatasetProvenance; change: (v: DatasetProvenance) => void }) {
  const update = (patch: Partial<DatasetProvenance>) => change({ ...value, ...patch });
  return <details className="dataset-source">
    <summary>出典・利用条件を記録</summary>
    <p className="muted">不明な項目は空欄のままにしてください。記録内容は計算履歴と成果に残ります。配布元・利用条件・測量品質の確認は利用者が行ってください。</p>
    <div className="form-grid">
      <label className="field">データ種別<select aria-label="データ種別" value={value.data_kind} onChange={e => update({ data_kind: e.target.value as DatasetProvenance['data_kind'] })}>
        <option value="unspecified">未指定</option><option value="synthetic">合成データ</option><option value="measured">実測データ（利用者申告）</option>
      </select></label>
      <label className="field">出典URL<input aria-label="出典URL" type="url" placeholder="配布元の資料・固定版へのURL" value={value.source_url} onChange={e => update({ source_url: e.target.value })} /></label>
      <label className="field">出典・著作者<input aria-label="出典・著作者" value={value.attribution} onChange={e => update({ attribution: e.target.value })} /></label>
      <label className="field">測量日（不明なら空欄）<input aria-label="測量日" type="date" value={value.survey_date} onChange={e => update({ survey_date: e.target.value })} /></label>
      <label className="field">利用条件<textarea aria-label="利用条件" placeholder="ライセンス名・条文の出典・必要な帰属表示など" value={value.usage_terms} onChange={e => update({ usage_terms: e.target.value })} /></label>
      <label className="field">変換・処理手順<textarea aria-label="変換・処理手順" placeholder="元ファイルの識別子、横断抽出・単位変換・除外・補間とその根拠など" value={value.processing} onChange={e => update({ processing: e.target.value })} /></label>
    </div>
  </details>;
}

export function DatasetDetails({ value }: { value?: DatasetProvenance | null }) {
  const kind = value?.data_kind === 'measured' ? '実測（利用者申告）' : value?.data_kind === 'synthetic' ? '合成' : '未指定';
  return <details className="dataset-source saved-source">
    <summary>記録されたデータ出典</summary>
    <p>データ種別: {kind}</p>
    {(['source_url', 'attribution', 'usage_terms', 'survey_date', 'processing'] as const).map((key, index) =>
      <p key={key}>{['出典URL', '出典・著作者', '利用条件', '測量日', '変換・処理手順'][index]}: <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value?.[key]?.trim() || '未記録'}</span></p>,
    )}
    <p className="muted">出典情報は利用者の申告です。配布元・利用条件・測量品質を自動確認していません。{value?.data_kind === 'synthetic' && '合成データは実河川の測量・実務試行の証拠にはなりません。'}</p>
  </details>;
}
