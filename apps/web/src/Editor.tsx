import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Project, Section, Station } from './types';
import { ground } from './types';
import { SectionChart } from './Charts';

export function NumberField({
  label,
  value,
  onChange,
  step = 'any',
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: string | number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
      />
    </label>
  );
}
export function SectionFields({
  section,
  onChange,
  scope = 'この断面',
}: {
  section: Section;
  onChange: (s: Section) => void;
  scope?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState<{ source: Section; section: Section } | null>(null);
  const pending = proposal?.source === section ? proposal.section : null;
  const update = (v: Partial<Section>) => onChange({ ...section, ...v } as Section);
  const describe = (s: Section) =>
    s.kind === 'rectangle'
      ? `矩形：幅 ${s.width} m、堤岸高 ${s.bank_height} m`
      : s.kind === 'trapezoid'
        ? `台形：底幅 ${s.bottom_width} m、法勾配 ${s.side_slope}、堤岸高 ${s.bank_height} m`
        : `測量点：${s.points.map((p) => `(${p.x}, ${p.z})`).join('、')} m`;
  return (
    <>
      <label className="field">
        <span>断面形式</span>
        <select
          aria-label="断面形式"
          value={pending?.kind ?? section.kind}
          onChange={(e) => {
            const kind = e.target.value;
            setProposal(null);
            setError('');
            if (kind === section.kind) return;
            const points = ground(section, 0);
            if (
              kind === 'survey' &&
              points.some((p, i) =>
                !Number.isFinite(p.x) || !Number.isFinite(p.z) ||
                (i > 0 && p.x <= points[i - 1].x),
              )
            ) {
              setError(
                'この断面は測量点形式にそのまま変換できません。垂直岸（同じx）や不正な座標を自動補正しません。矩形・台形形式を保持するか、正しい測量点CSVを明示的に取り込んでください。',
              );
              return;
            }
            const width = section.kind === 'rectangle'
              ? section.width
              : section.kind === 'trapezoid' ? section.bottom_width : 20;
            const bank_height = section.kind === 'survey' ? 8 : section.bank_height;
            const candidate: Section = kind === 'rectangle'
              ? { kind, width, bank_height }
              : kind === 'trapezoid'
                ? {
                    kind, bottom_width: width,
                    side_slope: section.kind === 'rectangle' ? 0 : 1.5, bank_height,
                  }
                : { kind: 'survey', points };
            setProposal({ source: section, section: candidate });
          }}
        >
          <option value="rectangle">矩形断面</option>
          <option value="trapezoid">台形断面</option>
          <option value="survey">任意横断面（測量点）</option>
        </select>
      </label>
      {error && <p role="alert" className="survey-input inline-error">{error}</p>}
      {pending && (
        <div className="survey-input" role="region" aria-label="断面形式の変更確認">
          <p>変更前：{describe(section)}</p>
          <p>変更候補：{describe(pending)}</p>
          <p className="muted">
            {JSON.stringify(ground(section, 0)) === JSON.stringify(ground(pending, 0))
              ? '座標を保持して形式を変更します。'
              : section.kind === 'survey'
                ? '形状が変わります。初期値を使った新しい形状で、元の測量断面の近似ではありません。'
                : '形状が変わります。底幅・堤岸高を引き継ぎ、法面を垂直にします。'}
            反映対象：{scope}。
            確認後に編集条件へ反映します。保存・計算は別操作です。
          </p>
          <button type="button" className="secondary" onClick={() => {
            onChange(pending);
            setProposal(null);
            setText(null);
            setError('');
          }}>断面形式の変更を反映</button>
          <button type="button" className="secondary" onClick={() => setProposal(null)}>断面形式の変更を取消</button>
        </div>
      )}
      {section.kind === 'rectangle' && (
        <NumberField label="幅 (m)" value={section.width} onChange={(width) => update({ width })} />
      )}
      {section.kind === 'trapezoid' && (
        <>
          <NumberField
            label="底幅 (m)"
            value={section.bottom_width}
            onChange={(bottom_width) => update({ bottom_width })}
          />
          <NumberField
            label="法勾配 (水平 / 鉛直)"
            value={section.side_slope}
            onChange={(side_slope) => update({ side_slope })}
          />
        </>
      )}
      {section.kind !== 'survey' && (
        <NumberField
          label="堤岸高・河床から (m)"
          value={section.bank_height}
          onChange={(bank_height) => update({ bank_height })}
        />
      )}
      {section.kind === 'survey' && (
        <div className="survey-input">
          <label className="field">
            <span>測量点 x, 相対高さ z (m) / 1行1点</span>
            <textarea
              aria-label="測量点"
              rows={6}
              value={text ?? section.points.map((p) => `${p.x}, ${p.z}`).join('\n')}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              try {
                const points = (text ?? section.points.map((p) => `${p.x},${p.z}`).join('\n'))
                  .trim()
                  .split('\n')
                  .map((line) => {
                    const fields = line.split(',').map((v) => v.trim());
                    if (
                      fields.length !== 2 ||
                      fields.some((v) => v === '' || !Number.isFinite(Number(v)))
                    )
                      throw new Error('各行に有限値の x,z を入力してください');
                    return { x: Number(fields[0]), z: Number(fields[1]) };
                  });
                onChange({ kind: 'survey', points });
                setText(null);
                setError('');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            測量点を反映
          </button>
          <p className="muted">最低点 z=0、x は昇順、両端は堤岸。起伏を保持し、計算水深で連続する1流路が必要です。</p>
        </div>
      )}
    </>
  );
}

export function Editor({ project, edit }: { project: Project; edit: (p: Project) => void }) {
  const [index, setIndex] = useState(0);
  const [all, setAll] = useState(false);
  const idx = Math.min(index, project.river.stations.length - 1);
  const station = project.river.stations[idx];
  function update(patch: Partial<Station>) {
    const stations = project.river.stations.map((s, i) =>
      i === idx || (all && patch.section) ? { ...s, ...patch } : s,
    );
    edit({ ...project, river: { ...project.river, stations } });
  }
  return (
    <div className="editor-layout">
      <section className="panel station-list">
        <div className="panel-heading">
          <h2>測点一覧</h2>
          <span className="badge">{project.river.stations.length} 断面</span>
        </div>
        <p className="muted">上流から下流へ距離が増加します。</p>
        {project.river.stations.map((s, i) => (
          <button
            type="button"
            key={i}
            className={`station ${idx === i ? 'selected' : ''}`}
            onClick={() => setIndex(i)}
          >
            <span>
              No.{String(i + 1).padStart(2, '0')}
              <strong>{s.chainage.toFixed(1)} m</strong>
            </span>
            <small>河床 {s.bed_elevation.toFixed(2)} m</small>
          </button>
        ))}
        <button
          type="button"
          className="secondary full"
          disabled={project.river.stations.length >= 200}
          onClick={() => {
            const last = project.river.stations.at(-1)!;
            edit({
              ...project,
              river: {
                ...project.river,
                stations: [
                  ...project.river.stations,
                  {
                    ...structuredClone(last),
                    chainage: last.chainage + 100,
                    bed_elevation: last.bed_elevation - project.river.normal_slope * 100,
                  },
                ],
              },
            });
            setIndex(project.river.stations.length);
          }}
        >
          <Plus size={15} />
          下流に断面を追加
        </button>
      </section>
      <div>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">CROSS SECTION / No.{idx + 1}</div>
              <h2>横断面を編集</h2>
            </div>
            <button
              type="button"
              className="icon-button danger"
              aria-label="選択断面を削除"
              disabled={project.river.stations.length <= 2}
              onClick={() => {
                edit({
                  ...project,
                  river: {
                    ...project.river,
                    stations: project.river.stations.filter((_, i) => i !== idx),
                  },
                });
                setIndex(Math.max(0, idx - 1));
              }}
            >
              <Trash2 size={17} />
            </button>
          </div>
          <div className="form-grid">
            <NumberField
              label="縦断距離 (m)"
              value={station.chainage}
              onChange={(chainage) => update({ chainage })}
            />
            <NumberField
              label="河床標高 (m / 共通基準高)"
              value={station.bed_elevation}
              onChange={(bed_elevation) => update({ bed_elevation })}
            />
            <NumberField
              label="粗度係数 n"
              value={station.roughness}
              onChange={(roughness) => update({ roughness })}
            />
          </div>
          <label className="check">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            断面形状の変更を全測点に反映
          </label>
          <div className="form-grid">
            <SectionFields
              key={`${project.id}-${idx}-${station.section.kind}`}
              section={station.section}
              scope={all ? '全測点の断面形状' : `No.${idx + 1}の断面形状`}
              onChange={(section) => update({ section })}
            />
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>断面プレビュー</h2>
            <span className="muted">共通基準高 / SI</span>
          </div>
          <SectionChart station={station} analysis={null} index={idx} />
          <p className="muted">変更後は「計算を実行」で新しい水位を確認してください。</p>
        </section>
      </div>
    </div>
  );
}
