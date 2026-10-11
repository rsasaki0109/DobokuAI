import { useState } from 'react';
import { api, type Project, type Station, type SpatialReference } from './types';
import { SectionChart } from './Charts';

type Source = {
  csv: string;
  file_name: string;
  elevation_mode: 'absolute' | 'relative';
  unit: string;
  vertical_datum: string;
  horizontal_reference: string;
};
type Preview = {
  valid: boolean;
  stations: Station[];
  reference: SpatialReference;
  diagnostics: { line: number | null; station: string | null; field: string; message: string }[];
  warnings: string[];
  review_token: string | null;
};
export function SurveyImport({
  project,
  edit,
  onImport,
  task,
}: {
  project: Project;
  edit: (p: Project) => void;
  onImport: (p: Project) => void;
  task: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [source, setSource] = useState<Source>({
    csv: '',
    file_name: '',
    elevation_mode: 'absolute',
    unit: 'm',
    vertical_datum: '',
    horizontal_reference: '流下距離・横断距離（局所座標、m）',
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const change = (patch: Partial<Source>) => {
    setSource((s) => ({ ...s, ...patch }));
    setPreview(null);
  };
  return (
    <section className="panel survey-import">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">SURVEY DATA / METRES</div>
          <h2>横断測量CSVの取込み</h2>
        </div>
        <span className="badge">プレビュー後に確認</span>
      </div>
      <details>
        <summary>CSV形式・対応範囲</summary>
        <p>
          UTF-8、64
          KiB以内、ヘッダーは次の順序で指定。同じ断面の行を連続させ、流下距離と横断xを昇順に配置してください。2〜200断面、断面ごとに3〜200点、全2000行以内。単一谷形のみ対応し、点の並べ替え・補間・座標変換は行いません。
        </p>
        <code>station,chainage_m,bed_elevation_m,roughness,x_m,elevation_m</code>
        <p>
          絶対標高の場合、elevation_mからbed_elevation_mを引きます。相対高さの場合、elevation_mをそのまま使います。各断面の最低点は河床から0
          mでなければなりません。
        </p>
      </details>
      <div className="form-grid">
        <label>
          横断測量CSV
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="横断測量CSV"
            onChange={(e) => {
              const file = e.target.files?.[0];
              change({ csv: '', file_name: '' });
              if (file)
                void task(async () => {
                  if (file.size > 65536) throw new Error('CSVは64 KiB以内');
                  const csv = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
                    await file.arrayBuffer(),
                  );
                  change({ csv, file_name: file.name });
                });
            }}
          />
        </label>
        <label>
          CSVの高さの解釈
          <select
            aria-label="CSVの高さの解釈"
            value={source.elevation_mode}
            onChange={(e) => change({ elevation_mode: e.target.value as Source['elevation_mode'] })}
          >
            <option value="absolute">絶対標高（共通基準高）</option>
            <option value="relative">河床からの相対高さ</option>
          </select>
        </label>
        <label>
          取込みデータの標高系
          <input
            aria-label="取込みデータの標高系"
            placeholder="例: T.P. / 仮想基準高"
            maxLength={100}
            value={source.vertical_datum}
            onChange={(e) => change({ vertical_datum: e.target.value })}
          />
        </label>
        <label>
          取込みデータの水平座標
          <input
            aria-label="取込みデータの水平座標"
            maxLength={100}
            value={source.horizontal_reference}
            onChange={(e) => change({ horizontal_reference: e.target.value })}
          />
        </label>
      </div>
      <p className="muted">
        単位: m。現在の全測点を置換し、施工案をクリアします。流量・参照勾配・境界水深は保持します。
      </p>
      <button
        className="secondary"
        disabled={
          !source.csv || !source.vertical_datum.trim() || !source.horizontal_reference.trim()
        }
        onClick={() =>
          void task(async () => {
            setPreview(null);
            setPreview(await api<Preview>('/imports/survey/preview', source));
          })
        }
      >
        CSVを検証・プレビュー
      </button>
      {preview && (
        <div className="import-preview">
          {preview.warnings.map((w) => (
            <p className="muted" key={w}>
              {w}
            </p>
          ))}
          {preview.valid ? (
            <>
              <p role="status">
                取込みプレビュー: {preview.stations.length} 断面。確認前の条件は変更されていません。
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>流下距離 m</th>
                      <th>河床標高 m</th>
                      <th>粗度 n</th>
                      <th>点数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.stations.map((st) => (
                      <tr key={st.chainage}>
                        <td>{st.chainage}</td>
                        <td>{st.bed_elevation}</td>
                        <td>{st.roughness}</td>
                        <td>{st.section.kind === 'survey' && st.section.points.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>最初の断面・標高基準: {source.vertical_datum}</p>
              <SectionChart station={preview.stations[0]} analysis={null} index={0} />
              <button
                className="primary"
                onClick={() =>
                  void task(async () => {
                    const p = await api<Project>('/imports/survey/apply', {
                      source,
                      project,
                      confirmed: true,
                      review_token: preview.review_token,
                    });
                    onImport(p);
                    setPreview(null);
                  })
                }
              >
                内容を確認して全測点を置換・施工案をクリア
              </button>
            </>
          ) : (
            <>
              <p role="alert">CSVを反映できません。診断を修正して再プレビューしてください。</p>
              <ul>
                {preview.diagnostics.map((d, i) => (
                  <li key={i}>
                    行 {d.line ?? '—'} / 断面 {d.station ?? '—'} / {d.field}: {d.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <hr />
      <h3>現在の座標・基準高</h3>
      <div className="form-grid">
        <label>
          プロジェクトの標高系
          <input
            aria-label="プロジェクトの標高系"
            value={project.reference.vertical_datum}
            onChange={(e) =>
              edit({
                ...project,
                reference: { ...project.reference, vertical_datum: e.target.value },
              })
            }
          />
        </label>
        <label>
          プロジェクトの水平座標
          <input
            aria-label="プロジェクトの水平座標"
            value={project.reference.horizontal_reference}
            onChange={(e) =>
              edit({
                ...project,
                reference: { ...project.reference, horizontal_reference: e.target.value },
              })
            }
          />
        </label>
      </div>
      {project.reference.import && (
        <p className="muted provenance">
          取込み元: {project.reference.import.file_name} / {project.reference.import.imported_at}
          <br />
          取込み元CSVのSHA-256: {project.reference.import.sha256}
          <br />
          取込み後の編集はこのハッシュに含まれません。現在の条件は再現用JSON・計算履歴に記録します。
        </p>
      )}
    </section>
  );
}
