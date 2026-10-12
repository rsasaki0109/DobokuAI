import { lazy, Suspense, useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Download,
  FileText,
  Folder,
  Layers,
  LayoutDashboard,
  LoaderCircle,
  MessageSquare,
  Mountain,
  Play,
  Plus,
  Save,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Waves,
} from 'lucide-react';
import type {
  Action,
  Analysis,
  AnalysisRequest,
  Project,
  Proposal,
  Scenario,
  StoredAnalysis,
} from './types';
import { api, colors, download, initialScenarios, saveBlob } from './types';
import { ProfileChart, SectionChart } from './Charts';
import { Editor, NumberField, SectionFields } from './Editor';
import { History } from './History';
import { SurveyImport } from './SurveyImport';
import { Sensitivity } from './Sensitivity';
import { Resolution } from './Resolution';
import { RiverDiagnostics } from './RiverDiagnostics';
import { BoundaryStageInput } from './BoundaryStageInput';
import { ReviewPack } from './ReviewPack';
const River3D = lazy(() => import('./River3D'));
const Infrastructure3D = lazy(() => import('./Infrastructure3D'));
const DamAnalysis = lazy(() => import('./DamAnalysis'));
const navigation = [
  { id: 'dashboard', name: 'プロジェクト', en: 'PROJECT DASHBOARD', icon: LayoutDashboard },
  { id: 'editor', name: '横断面エディタ', en: 'CROSS SECTION EDITOR', icon: SlidersHorizontal },
  { id: 'simulation', name: '水理計算', en: 'HYDRAULIC SIMULATION', icon: Waves },
  { id: 'profile', name: '縦断水面形', en: 'WATER SURFACE PROFILE', icon: Activity },
  { id: 'comparison', name: '施工シナリオ比較', en: 'CONSTRUCTION SCENARIOS', icon: Layers },
  { id: 'structures', name: '3D施設ギャラリー', en: 'INFRASTRUCTURE STUDIO', icon: Mountain },
  { id: 'dam', name: 'ダム予備照査', en: 'DAM HYDRAULICS & STATICS', icon: Layers },
  { id: 'assistant', name: 'AI アシスタント', en: 'AI ASSISTANT', icon: MessageSquare },
];
const f = (n: number, digits = 2) =>
  n.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
function actionLabel(a: Action, p: Project) {
  switch (a.tool) {
    case 'set_discharge':
      return `流量: ${p.river.discharge} → ${a.value} m³/s（基本条件を変更）`;
    case 'compare_roughness':
      return `粗度: 現在の各断面 → ${a.value} の比較案を追加`;
    case 'compare_excavation':
      return `河床を ${a.depth} m 掘削する比較案を追加（堤岸・境界水位を維持）`;
    case 'create_report':
      return '現在の計算条件と施工案を含む HTML レポートを出力';
  }
}

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [page, setPage] = useState(() => { const view = new URLSearchParams(window.location.search).get('view'); return view === 'structures' || view === 'dam' ? view : 'dashboard'; });
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [scenarios, setScenarios] = useState<Scenario[]>(structuredClone(initialScenarios));
  const [staged, setStaged] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [metric, setMetric] = useState<'stage' | 'depth' | 'velocity'>('stage');
  const [stationIndex, setStationIndex] = useState(0);
  const [show3d, setShow3d] = useState(false);
  const [prompt, setPrompt] = useState('流量を100m³/sに変更して再計算して');
  const [local, setLocal] = useState(true);
  const [agent, setAgent] = useState<{ proposal: Proposal; provider: string } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [sample, saved] = await Promise.all([
          api<Project>('/sample'),
          api<Project[]>('/projects'),
        ]);
        const active = saved.find((p) => p.id === sample.id) ?? sample;
        if (alive) {
          setProject(active);
          setProjects(saved);
          setScenarios(active.scenarios ?? []);
          setStaged(active.staged ?? false);
        }
        const result = await api<Analysis>('/compare', {
          project: active,
          scenarios: active.scenarios ?? [],
          staged: active.staged ?? false,
        });
        if (alive) setAnalysis(result);
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(p: Project) {
    setProject(p);
    setAnalysis(null);
    setHistoryId(null);
    setAgent(null);
    setNotice('');
  }
  function updateScenarios(ss: Scenario[]) {
    setScenarios(ss);
    setAnalysis(null);
    setHistoryId(null);
    setAgent(null);
  }
  const request = (p = project!, ss = scenarios): AnalysisRequest => ({
    project: { ...p, scenarios: ss, staged },
    scenarios: ss,
    staged,
  });
  const run = () =>
    task(async () => {
      setAnalysis(null);
      setHistoryId(null);
      const saved = await api<StoredAnalysis>('/runs', request());
      setAnalysis(saved.analysis);
      setHistoryId(saved.id);
      setHistoryRevision((n) => n + 1);
      setNotice('数値計算と施工比較が完了しました');
    });
  const openHistory = (id: number) =>
    task(async () => {
      const saved = await api<StoredAnalysis>(`/runs/${id}`);
      setProject(saved.analysis.project);
      setScenarios(saved.analysis.project.scenarios);
      setStaged(saved.analysis.staged);
      setAnalysis(saved.analysis);
      setHistoryId(saved.id);
      setAgent(null);
      setStationIndex(0);
      setNotice(`計算履歴 #${saved.id} の条件と保存結果を復元しました（再計算していません）`);
    });
  const info = navigation.find((n) => n.id === page)!;
  const idx = project ? Math.min(stationIndex, project.river.stations.length - 1) : 0;
  const rows = analysis?.run.profile.rows;
  const firstComparison = analysis?.comparisons[0];
  const maximum = (key: 'depth' | 'velocity' | 'froude') =>
    rows ? Math.max(...rows.map((r) => r[key])) : null;
  const exportReport = (kind: 'html' | 'csv') =>
    task(async () => {
      await download(
        kind,
        request(),
        `doboku-${kind === 'html' ? 'report.html' : 'results.csv'}`,
        historyId,
      );
      setNotice(
        `${kind.toUpperCase()} を出力しました${historyId ? '（保存結果・元の実行日時）' : '（現在の条件を再計算）'}`,
      );
    });

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage('dashboard');
          }}
        >
          <div className="brand-symbol">
            <Mountain size={28} />
            <Waves size={19} />
          </div>
          <div>
            Doboku<span>AI</span>
            <small>CIVIL ENGINEERING WORKSPACE</small>
          </div>
        </a>
        <div className="workspace-label">
          WORKSPACE <span>MVP / 0.2</span>
        </div>
        <nav>
          {navigation.map((n) => (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              className={page === n.id ? 'active' : ''}
              aria-current={page === n.id ? 'page' : undefined}
            >
              <n.icon size={19} />
              {n.name}
              {page === n.id && <ChevronRight size={15} className="nav-chevron" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="engine-status">
            <span className="dot" />
            <div>
              Deterministic Rust Engine<small>SI units · Standard step method</small>
            </div>
          </div>
          <p>
            AI が条件を整理し、
            <br />
            エンジンが数値を計算します。
          </p>
          <div className="sidebar-version">
            RIVER ENGINEERING <span>v0.2.0</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <Folder size={16} />
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>河川エンジニアリング</strong>
          </div>
          <div className="topbar-right">
            <span className="local-badge">
              <span className="dot" />
              Local project / SQLite
            </span>
            <div className="avatar">CE</div>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">{info.en}</div>
              <h1>{info.name}</h1>
              <p>
                {page === 'dashboard'
                  ? '河川の条件を理解し、改修案を確かな数値で比較する。'
                  : page === 'structures'
                    ? 'ダム・橋梁・砂防の架空モデルを、地形とともに立体で見る。'
                  : page === 'dam'
                    ? '条件を確認し、重力式ダムの荷重・接触状態・自由越流容量を計算する。'
                  : page === 'editor'
                    ? '測量断面と河床標高を編集し、河川モデルを構築します。'
                    : page === 'assistant'
                      ? '自然言語から条件変更を提案。確認後に計算エンジンへ適用します。'
                      : '同じ座標系・基準高で、計算条件と結果を確認します。'}
              </p>
            </div>
            {page !== 'structures' && page !== 'dam' && <div className="heading-actions">
              <button
                className="secondary"
                disabled={!project || busy}
                onClick={() => exportReport('html')}
              >
                <FileText size={16} />
                レポート
              </button>
              <button className="primary" disabled={!project || busy} onClick={run}>
                {busy ? <LoaderCircle size={16} className="spin" /> : <Play size={15} />}計算を実行
              </button>
            </div>}
          </div>
          {error && page !== 'structures' && page !== 'dam' && (
            <div className="alert error" role="alert">
              <CircleHelp size={19} />
              <div>
                <strong>処理を完了できませんでした</strong>
                <p>{error}</p>
              </div>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <Check size={18} />
              {notice}
            </div>
          )}
          {page === 'structures' ? (
            <Suspense fallback={<p>施設の3Dモデルを準備しています…</p>}><Infrastructure3D onOpenDam={() => setPage('dam')} /></Suspense>
          ) : page === 'dam' ? (
            <Suspense fallback={<p>ダム予備照査を準備しています…</p>}><DamAnalysis /></Suspense>
          ) : !project ? (
            <section className="panel empty">
              {busy ? (
                'サンプル河川を読み込み、初期計算しています…'
              ) : (
                <>
                  <p>API の起動を確認して再試行してください。</p>
                  <button className="secondary" onClick={() => window.location.reload()}>
                    再読み込み
                  </button>
                </>
              )}
            </section>
          ) : (
            <>
              <fieldset disabled={busy} className="workspace-content">
                <div className="project-strip">
                  <div className="project-icon">
                    <Waves size={24} />
                  </div>
                  <div>
                    <span className="eyebrow">ACTIVE PROJECT</span>
                    <h2>{project.name}</h2>
                    <span className="muted">
                      {project.river.stations.length} 断面 ·{' '}
                      {f(
                        project.river.stations.at(-1)!.chainage -
                          project.river.stations[0].chainage,
                        0,
                      )}{' '}
                      m ·{' '}
                      {project.river.boundary.regime === 'subcritical'
                        ? '常流 / 下流端境界'
                        : '射流 / 上流端境界'}
                    </span>
                  </div>
                  <div className="project-tools">
                    <select
                      aria-label="保存済みプロジェクト"
                      value={projects.some((p) => p.id === project.id) ? project.id : ''}
                      onChange={(e) => {
                        const p = projects.find((p) => p.id === e.target.value);
                        if (p) {
                          edit(structuredClone(p));
                          setScenarios(p.scenarios ?? []);
                          setStaged(p.staged ?? false);
                          setStationIndex(0);
                        }
                      }}
                    >
                      <option value="" disabled>
                        未保存プロジェクト
                      </option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="icon-button"
                      title="プロジェクトを保存"
                      aria-label="プロジェクトを保存"
                      onClick={() =>
                        task(async () => {
                          await api('/projects', { ...project, scenarios, staged });
                          setProjects(await api<Project[]>('/projects'));
                          setNotice('プロジェクトを SQLite に保存しました');
                        })
                      }
                    >
                      <Save size={18} />
                    </button>
                  </div>
                </div>
                {!analysis && (
                  <div className="alert neutral">
                    <Activity size={17} />
                    条件が変更されています。「計算を実行」で結果を更新してください。
                  </div>
                )}
                {analysis && historyId && (
                  <div className="alert neutral" role="status">
                    <Activity size={17} />
                    保存結果 #{historyId} ·{' '}
                    {new Date(analysis.run.executed_at).toLocaleString('ja-JP', {
                      timeZone: 'Asia/Tokyo',
                    })}{' '}
                    JST · engine {analysis.run.engine_version}（条件を編集すると表示を解除）
                  </div>
                )}

                {page === 'dashboard' && (
                  <>
                    <div className="metrics">
                      <Metric
                        label="流量"
                        value={f(project.river.discharge, 0)}
                        unit="m³/s"
                        detail="定常・全区間一定"
                        icon={<Waves size={19} />}
                      />
                      <Metric
                        label="最大水深"
                        value={maximum('depth') === null ? '—' : f(maximum('depth')!)}
                        unit="m"
                        detail="全測点の計算結果"
                        icon={<ArrowDownRight size={19} />}
                      />
                      <Metric
                        label="最大流速"
                        value={maximum('velocity') === null ? '—' : f(maximum('velocity')!)}
                        unit="m/s"
                        detail="断面平均流速"
                        icon={<ArrowRight size={19} />}
                      />
                      <Metric
                        label="改修案の最大水位差"
                        value={
                          firstComparison
                            ? `${firstComparison.max_water_change > 0 ? '+' : ''}${f(firstComparison.max_water_change, 3)}`
                            : '—'
                        }
                        unit="m"
                        detail={firstComparison?.scenario.name ?? '未計算'}
                        icon={<ArrowUpRight size={19} />}
                      />
                    </div>
                    <div className="dashboard-grid">
                      <section className="panel profile-panel">
                        <div className="panel-heading">
                          <div>
                            <div className="eyebrow">LONGITUDINAL PROFILE</div>
                            <h2>縦断水面形</h2>
                          </div>
                          <span className="badge">共通基準高</span>
                        </div>
                        {analysis ? <ProfileChart analysis={analysis} /> : <Empty />}
                      </section>
                      <section className="panel condition-card">
                        <div className="panel-heading">
                          <h2>計算条件</h2>
                          <Waves size={18} />
                        </div>
                        <dl>
                          <dt>計算手法</dt>
                          <dd>標準逐次計算法</dd>
                          <dt>粗度係数 n</dt>
                          <dd>
                            {project.river.stations.every(
                              (s) => s.roughness === project.river.stations[0].roughness,
                            )
                              ? project.river.stations[0].roughness
                              : '断面ごとに設定'}
                          </dd>
                          <dt>参照河床勾配</dt>
                          <dd>1 / {f(1 / project.river.normal_slope, 0)}</dd>
                          <dt>境界水深</dt>
                          <dd>{f(project.river.boundary.depth)} m</dd>
                          <dt>流況</dt>
                          <dd>
                            {project.river.boundary.regime === 'subcritical' ? '常流' : '射流'}
                          </dd>
                        </dl>
                        <button className="text-button" onClick={() => setPage('simulation')}>
                          条件を編集
                          <ArrowRight size={15} />
                        </button>
                        <div className="model-note">
                          <CircleHelp size={17} />
                          <p>1次元定常流モデルです。跳水・越岸・急変は計算対象外です。</p>
                        </div>
                      </section>
                    </div>
                    <div className="dashboard-grid">
                      <section className="panel">
                        <div className="panel-heading">
                          <div>
                            <div className="eyebrow">CONSTRUCTION STUDY</div>
                            <h2>施工案の比較</h2>
                          </div>
                          <button className="text-button" onClick={() => setPage('comparison')}>
                            すべて表示
                            <ArrowRight size={15} />
                          </button>
                        </div>
                        {analysis?.comparisons.length ? (
                          <ScenarioSummary analysis={analysis} />
                        ) : (
                          <Empty />
                        )}
                      </section>
                      <section className="panel assistant-promo">
                        <div className="spark-icon">
                          <Sparkles size={22} />
                        </div>
                        <div className="eyebrow">YOUR ENGINEERING ASSISTANT</div>
                        <h2>次の検討を、自然言語で。</h2>
                        <p>
                          「河道を1m掘削した場合の水面形を表示して」
                          <br />
                          条件の提案を確認してから再計算できます。
                        </p>
                        <button className="secondary" onClick={() => setPage('assistant')}>
                          アシスタントを開く
                          <ArrowRight size={16} />
                        </button>
                      </section>
                    </div>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>プロジェクト管理</h2>
                      </div>
                      <div className="form-grid">
                        <label className="field">
                          <span>プロジェクト名</span>
                          <input
                            value={project.name}
                            onChange={(e) => edit({ ...project, name: e.target.value })}
                          />
                        </label>
                        <button
                          className="secondary self-end"
                          onClick={() => {
                            edit({
                              ...structuredClone(project),
                              id: crypto.randomUUID(),
                              name: `${project.name}（複製）`,
                            });
                          }}
                        >
                          <Plus size={16} />
                          複製して新規作成
                        </button>
                        <button
                          className="secondary self-end"
                          onClick={() =>
                            task(async () => {
                              const sample = await api<Project>('/sample');
                              edit(sample);
                              setScenarios(structuredClone(initialScenarios));
                              setStaged(false);
                              setAnalysis(
                                await api<Analysis>('/compare', {
                                  project: sample,
                                  scenarios: initialScenarios,
                                  staged: false,
                                }),
                              );
                            })
                          }
                        >
                          サンプルを読み込む
                        </button>
                      </div>
                    </section>
                    <History
                      projectId={project.id}
                      revision={historyRevision}
                      activeId={historyId}
                      onOpen={openHistory}
                    />
                    <ReviewPack key={`${project.id}:${historyId}`} projectId={project.id} runId={historyId} task={task} />
                  </>
                )}

                {page === 'editor' && (
                  <>
                    <SurveyImport
                      key={project.id}
                      project={{ ...project, scenarios, staged }}
                      edit={edit}
                      task={task}
                      onImport={(p) => {
                        edit(p);
                        setScenarios([]);
                        setStaged(false);
                        setStationIndex(0);
                        setNotice(
                          '横断測量CSVを反映しました。計算条件を確認して再計算し、プロジェクトを保存してください。',
                        );
                      }}
                    />
                    <Editor project={project} edit={edit} />
                  </>
                )}

                {page === 'simulation' && (
                  <>
                    <RiverDiagnostics project={project} task={task} />
                    <Sensitivity key={`sensitivity:${JSON.stringify(project)}`} project={project} task={task} />
                    <Resolution key={`resolution:${JSON.stringify(project)}`} project={project} task={task} />
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <div className="eyebrow">BOUNDARY & PARAMETERS</div>
                          <h2>水理計算条件</h2>
                        </div>
                        <span className="badge">SI 単位系</span>
                      </div>
                      <div className="form-grid">
                        <NumberField
                          label="流量 Q (m³/s)"
                          value={project.river.discharge}
                          onChange={(discharge) =>
                            edit({ ...project, river: { ...project.river, discharge } })
                          }
                        />
                        <NumberField
                          label="全断面の粗度係数 n"
                          value={project.river.stations[0].roughness}
                          onChange={(roughness) =>
                            edit({
                              ...project,
                              river: {
                                ...project.river,
                                stations: project.river.stations.map((s) => ({ ...s, roughness })),
                              },
                            })
                          }
                        />
                        <NumberField
                          label="等流水深用の参照勾配 S₀"
                          value={project.river.normal_slope}
                          onChange={(normal_slope) =>
                            edit({ ...project, river: { ...project.river, normal_slope } })
                          }
                        />
                        <label className="field">
                          <span>境界条件 / 流況</span>
                          <select
                            aria-label="境界条件 / 流況"
                            value={project.river.boundary.regime}
                            onChange={(e) =>
                              edit({
                                ...project,
                                river: {
                                  ...project.river,
                                  boundary: {
                                    ...project.river.boundary,
                                    regime: e.target.value as 'subcritical' | 'supercritical',
                                  },
                                },
                              })
                            }
                          >
                            <option value="subcritical">常流 — 下流端の水深を指定</option>
                            <option value="supercritical">射流 — 上流端の水深を指定</option>
                          </select>
                        </label>
                        <NumberField
                          label="境界水深 (m / 河床から)"
                          value={project.river.boundary.depth}
                          onChange={(depth) =>
                            edit({
                              ...project,
                              river: {
                                ...project.river,
                                boundary: { ...project.river.boundary, depth },
                              },
                            })
                          }
                        />
                        <BoundaryStageInput project={project} edit={edit} />
                        <div className="field">
                          <span>実河床への反映（明示的操作）</span>
                          <button
                            className="secondary"
                            onClick={() => {
                              const a = project.river.stations[0];
                              edit({
                                ...project,
                                river: {
                                  ...project.river,
                                  stations: project.river.stations.map((s) => ({
                                    ...s,
                                    bed_elevation:
                                      a.bed_elevation -
                                      (s.chainage - a.chainage) * project.river.normal_slope,
                                  })),
                                },
                              });
                            }}
                          >
                            参照勾配を河床標高に反映
                          </button>
                        </div>
                      </div>
                      <p className="muted">
                        不等流は各測点の実標高を使用。参照勾配の変更だけでは河床は変更されません。境界水位は施工比較中に固定します。
                        水位欄は共通基準高のmで入力し、現在の境界河床を引いて水深を設定します。基本条件の河床や流況を編集すると表示水位も変わるため、境界を再確認してください。水位の標高基準・単位変換は行いません。
                      </p>
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>計算結果</h2>
                        <span className="badge">{analysis ? '収束確認済み' : '未計算'}</span>
                      </div>
                      {analysis ? (
                        <>
                          <ResultsTable analysis={analysis} />
                          <p className="muted">
                            最大エネルギー残差:{' '}
                            {Math.max(
                              ...analysis.run.profile.rows.map((r) => Math.abs(r.energy_residual)),
                            ).toExponential(2)}{' '}
                            m ・エンジン {analysis.run.engine_version}
                          </p>
                        </>
                      ) : (
                        <Empty />
                      )}
                    </section>
                  </>
                )}

                {(page === 'profile' || page === 'comparison') && (
                  <>
                    {page === 'comparison' && (
                      <section className="panel">
                        <div className="panel-heading">
                          <div>
                            <div className="eyebrow">SCENARIO BUILDER</div>
                            <h2>施工条件と検討案</h2>
                          </div>
                          <button
                            className="secondary"
                            disabled={scenarios.length >= 6}
                            onClick={() =>
                              updateScenarios([
                                ...scenarios,
                                {
                                  name: `施工案 ${scenarios.length + 1}`,
                                  modification: { kind: 'excavate', depth: 0.5 },
                                },
                              ])
                            }
                          >
                            <Plus size={15} />
                            案を追加
                          </button>
                        </div>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={staged}
                            onChange={(e) => {
                              setStaged(e.target.checked);
                              setAnalysis(null);
                              setHistoryId(null);
                              setAgent(null);
                            }}
                          />
                          施工段階として順に累積する（オフ: 独立した代替案）
                        </label>
                        {scenarios.map((s, i) => (
                          <div className="scenario-form" key={i}>
                            <div className="scenario-index" style={{ background: colors[i] }}>
                              {i + 1}
                            </div>
                            <label className="field">
                              <span>案 / 段階の名称</span>
                              <input
                                value={s.name}
                                onChange={(e) =>
                                  updateScenarios(
                                    scenarios.map((s, j) =>
                                      i === j ? { ...s, name: e.target.value } : s,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label className="field">
                              <span>条件変更</span>
                              <select
                                value={s.modification.kind}
                                onChange={(e) => {
                                  const kind = e.target.value;
                                  const modification =
                                    kind === 'excavate'
                                      ? { kind: 'excavate' as const, depth: 1 }
                                      : kind === 'roughness'
                                        ? { kind: 'roughness' as const, value: 0.035 }
                                        : kind === 'cofferdam'
                                          ? { kind: 'cofferdam' as const, blocked_width: 2 }
                                          : {
                                              kind: 'replace_section' as const,
                                              section: structuredClone(
                                                project.river.stations[0].section,
                                              ),
                                            };
                                  updateScenarios(
                                    scenarios.map((s, j) => (i === j ? { ...s, modification } : s)),
                                  );
                                }}
                              >
                                <option value="excavate">河道掘削</option>
                                <option value="replace_section">断面形状の変更</option>
                                <option value="cofferdam">仮締切・幅閉塞</option>
                                <option value="roughness">粗度係数の変更</option>
                              </select>
                            </label>
                            {s.modification.kind === 'excavate' && (
                              <NumberField
                                label="掘削深 (m)"
                                value={s.modification.depth}
                                onChange={(depth) =>
                                  updateScenarios(
                                    scenarios.map((s, j) =>
                                      i === j
                                        ? { ...s, modification: { kind: 'excavate', depth } }
                                        : s,
                                    ),
                                  )
                                }
                              />
                            )}
                            {s.modification.kind === 'roughness' && (
                              <NumberField
                                label="粗度係数 n"
                                value={s.modification.value}
                                onChange={(value) =>
                                  updateScenarios(
                                    scenarios.map((s, j) =>
                                      i === j
                                        ? { ...s, modification: { kind: 'roughness', value } }
                                        : s,
                                    ),
                                  )
                                }
                              />
                            )}
                            {s.modification.kind === 'cofferdam' && (
                              <NumberField
                                label="底幅の閉塞幅 (m)"
                                value={s.modification.blocked_width}
                                onChange={(blocked_width) =>
                                  updateScenarios(
                                    scenarios.map((s, j) =>
                                      i === j
                                        ? {
                                            ...s,
                                            modification: { kind: 'cofferdam', blocked_width },
                                          }
                                        : s,
                                    ),
                                  )
                                }
                              />
                            )}
                            <button
                              className="icon-button danger self-end"
                              aria-label={`施工案${i + 1}を削除`}
                              onClick={() => updateScenarios(scenarios.filter((_, j) => j !== i))}
                            >
                              <Trash2 size={17} />
                            </button>
                            {s.modification.kind === 'replace_section' && (
                              <div className="form-grid section-replacement">
                                <SectionFields
                                  key={`${project.id}-${i}-${s.modification.section.kind}`}
                                  section={s.modification.section}
                                  scope={`施工案「${s.name}」の全測点の断面形状`}
                                  onChange={(section) =>
                                    updateScenarios(
                                      scenarios.map((s, j) =>
                                        i === j
                                          ? {
                                              ...s,
                                              modification: { kind: 'replace_section', section },
                                            }
                                          : s,
                                      ),
                                    )
                                  }
                                />
                              </div>
                            )}
                          </div>
                        ))}
                        {!scenarios.length && (
                          <p className="muted">施工案は未登録です。基本条件のみ計算します。</p>
                        )}
                        <p className="muted">
                          全区間を変更する簡易モデル。掘削は堤岸を固定し、断面内の地盤を下げます。仮締切は損失・洗掘・安定性を含みません。費用・工期は算定しません。
                        </p>
                      </section>
                    )}
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>縦断方向の分布</h2>
                        <div className="segmented">
                          {(['stage', 'depth', 'velocity'] as const).map((m) => (
                            <button
                              key={m}
                              className={metric === m ? 'selected' : ''}
                              onClick={() => setMetric(m)}
                            >
                              {m === 'stage' ? '水位' : m === 'depth' ? '水深' : '流速'}
                            </button>
                          ))}
                        </div>
                      </div>
                      {analysis ? <ProfileChart analysis={analysis} metric={metric} /> : <Empty />}
                    </section>
                    {analysis && (
                      <>
                        <section className="panel">
                          <div className="panel-heading">
                            <h2>施工前後の横断図</h2>
                            <label className="inline-select">
                              測点
                              <select
                                aria-label="横断図の測点"
                                value={idx}
                                onChange={(e) => setStationIndex(Number(e.target.value))}
                              >
                                {project.river.stations.map((s, i) => (
                                  <option key={i} value={i}>
                                    {s.chainage} m
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <SectionChart
                            station={project.river.stations[idx]}
                            analysis={analysis}
                            index={idx}
                          />
                        </section>
                        <section className="panel">
                          <div className="panel-heading">
                            <h2>施工比較の数値結果</h2>
                            <span className="badge">{staged ? '累積段階' : '代替案'}</span>
                          </div>
                          <ScenarioSummary analysis={analysis} />
                          <p className="muted">
                            水位差・土量は施工前との比較。表示水位差は最大絶対変化地点の符号付き値です。
                          </p>
                          <ResultsTable analysis={analysis} comparisons />
                        </section>
                        {page === 'profile' && (
                          <section className="panel">
                            <label className="check">
                              <input
                                type="checkbox"
                                checked={show3d}
                                onChange={(e) => setShow3d(e.target.checked)}
                              />
                              3D 参考表示（断面の空間的な連続性）
                            </label>
                            {show3d && (
                              <Suspense fallback={<p>3D 表示を準備しています…</p>}>
                                <River3D analysis={analysis} />
                              </Suspense>
                            )}
                          </section>
                        )}
                      </>
                    )}
                  </>
                )}

                {page === 'assistant' && (
                  <div className="agent-layout">
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <div className="eyebrow">PROPOSE → REVIEW → COMPUTE</div>
                          <h2>エンジニアリング・アシスタント</h2>
                        </div>
                        <Sparkles size={23} />
                      </div>
                      <p className="muted">
                        条件解釈の提案と、Rust が算出する数値結果を区別して表示します。
                      </p>
                      <div className="prompt-examples">
                        {[
                          '流量を100m³/sに変更して再計算して',
                          '粗度係数を0.035に変更した場合の水位を比較して',
                          '河道を1m掘削した場合の水面形を表示して',
                          '施工前後の計算結果をレポートにまとめて',
                        ].map((s) => (
                          <button
                            className="prompt-example"
                            key={s}
                            onClick={() => {
                              setPrompt(s);
                              setAgent(null);
                            }}
                          >
                            {s}
                            <ArrowUpRight size={14} />
                          </button>
                        ))}
                      </div>
                      <label className="field">
                        <span>検討したい条件を入力</span>
                        <textarea
                          rows={4}
                          value={prompt}
                          onChange={(e) => {
                            setPrompt(e.target.value);
                            setAgent(null);
                          }}
                        />
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={local}
                          onChange={(e) => {
                            setLocal(e.target.checked);
                            setAgent(null);
                          }}
                        />
                        ローカル操作ルールを使用（APIキー不要）
                      </label>
                      <button
                        className="primary"
                        onClick={() =>
                          task(async () => {
                            setAgent(null);
                            setAgent(await api('/agent/propose', { prompt, local }));
                          })
                        }
                      >
                        <Sparkles size={16} />
                        操作を提案
                      </button>
                      {agent && (
                        <div className="proposal">
                          <span className="badge">条件解釈・説明 / {agent.provider}</span>
                          <p>{agent.proposal.explanation}</p>
                          <h3>適用する操作</h3>
                          {agent.proposal.actions.map((a, i) => (
                            <div className="action-preview" key={i}>
                              <Check size={16} />
                              <span>{actionLabel(a, project)}</span>
                            </div>
                          ))}
                          <p className="muted">
                            適用前の条件は変更されていません。比較案は現在の案に追加されます。失敗時は条件変更を反映しません。
                          </p>
                          <button
                            className="primary"
                            onClick={() =>
                              task(async () => {
                                const result = await api<{
                                  project: Project;
                                  analysis: Analysis;
                                  report_requested: boolean;
                                  history_id: number;
                                }>('/agent/apply', {
                                  ...request(),
                                  proposal: agent.proposal,
                                  confirmed: true,
                                });
                                setProject(result.project);
                                setAnalysis(result.analysis);
                                setHistoryId(result.history_id);
                                setHistoryRevision((n) => n + 1);
                                const ss = result.analysis.comparisons.map((c) => c.scenario);
                                setScenarios(ss);
                                setAgent(null);
                                if (result.report_requested)
                                  await download(
                                    'html',
                                    { project: result.project, scenarios: ss, staged },
                                    'doboku-report.html',
                                    result.history_id,
                                  );
                                setNotice('確認済みツールを適用し、Rust エンジンで計算しました');
                              })
                            }
                          >
                            条件を確認して適用・再計算
                            <ArrowRight size={15} />
                          </button>
                        </div>
                      )}
                    </section>
                    <section className="panel agent-result">
                      <div className="eyebrow">DETERMINISTIC ENGINE OUTPUT</div>
                      <h2>数値計算結果</h2>
                      {analysis ? (
                        <>
                          <ProfileChart analysis={analysis} />
                          <p>
                            Q = {analysis.run.river.discharge} m³/s / 最大水深{' '}
                            {f(maximum('depth')!)} m
                          </p>
                          <p className="muted">
                            {new Date(analysis.run.executed_at).toLocaleString('ja-JP', {
                              timeZone: 'Asia/Tokyo',
                            })}{' '}
                            JST / engine {analysis.run.engine_version}
                          </p>
                        </>
                      ) : (
                        <Empty />
                      )}
                    </section>
                  </div>
                )}

                <section className="export-strip">
                  <div>
                    <Download size={20} />
                    <div>
                      <strong>計算結果を持ち出す</strong>
                      <span>
                        {historyId
                          ? '保存時の結果と実行日時で出力します。'
                          : 'CSV・HTML は現在の条件を再計算します。'}{' '}
                        条件・バージョン・実行日時を記録。
                      </span>
                    </div>
                  </div>
                  <div className="heading-actions">
                    <button className="secondary" onClick={() => exportReport('csv')}>
                      CSV
                    </button>
                    <button className="secondary" onClick={() => exportReport('html')}>
                      HTML レポート
                    </button>
                    <button
                      className="secondary"
                      disabled={!analysis}
                      onClick={() => {
                        if (analysis)
                          saveBlob(
                            new Blob([JSON.stringify(analysis, null, 2)], {
                              type: 'application/json',
                            }),
                            'doboku-analysis.json',
                          );
                      }}
                    >
                      再現用 JSON
                    </button>
                  </div>
                </section>
                <details className="limitations">
                  <summary>
                    <CircleHelp size={15} />
                    計算の前提と適用上の注意
                  </summary>
                  <p>
                    1次元定常・一定流量・静水圧・エネルギー補正係数α=1。Manning摩擦勾配の区間平均を使用。常流は下流端、射流は上流端に境界水深を指定します。限界流付近（Fr
                    の1からの差が2%以内）・越岸・混在流況・跳水・構造物・急変は未対応です。測量点の起伏は保持します。計算水深で連続する1流路があり、限界水深・等流水深が一意となる同じ連続水深範囲だけを扱います。分離流路、段差による不連続な解は拒否します。隣接幅比25%と河床勾配0.1の上限を設けていますが、実際の遷移が緩やかかどうかは別途判断が必要です。断面数2〜200。等流水深は正の参照勾配を使う診断値です。計算可能であっても設計実務への適合を保証せず、測量・境界条件・断面間隔と独立照査が必要です。
                  </p>
                </details>
              </fieldset>
              <footer>
                <span>DobokuAI · River Engineering MVP</span>
                <span>Deterministic computation. Reviewable decisions.</span>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="empty">
      <Waves size={28} />
      <p>計算を実行すると、ここに結果が表示されます。</p>
    </div>
  );
}
function Metric({
  label,
  value,
  unit,
  detail,
  icon,
}: {
  label: string;
  value: string;
  unit: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <section className="metric">
      <div className="metric-label">
        {label}
        <span>{icon}</span>
      </div>
      <div className="metric-value">
        {value}
        <span>{unit}</span>
      </div>
      <p>{detail}</p>
    </section>
  );
}
function ScenarioSummary({ analysis }: { analysis: Analysis }) {
  return (
    <div className="scenario-summary">
      {analysis.comparisons.map((c, i) => (
        <div className="scenario-result" key={i}>
          <span className="scenario-marker" style={{ background: colors[i] }} />
          <div>
            <strong>{c.scenario.name}</strong>
            <p className="muted">
              {c.cut_volume === null
                ? '土量: 未算定'
                : `掘削 ${f(c.cut_volume, 0)} m³ / 盛土 ${f(c.fill_volume ?? 0, 0)} m³`}
            </p>
            <small>{c.volume_note}</small>
          </div>
          <div className="delta">
            {c.max_water_change > 0 ? '+' : ''}
            {f(c.max_water_change, 3)}
            <span>m</span>
          </div>
        </div>
      ))}
    </div>
  );
}
function ResultsTable({
  analysis,
  comparisons = false,
}: {
  analysis: Analysis;
  comparisons?: boolean;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>距離 (m)</th>
            <th>河床 (m)</th>
            <th>水位 (m)</th>
            <th>水深 (m)</th>
            <th>流速 (m/s)</th>
            <th>Fr</th>
            {comparisons ? (
              analysis.comparisons.flatMap((c, i) => [
                <th key={`${i}-stage`}>{c.scenario.name} 水位 / 差 (m)</th>,
                <th key={`${i}-cut`}>{c.scenario.name} 掘削断面積 (m²)</th>,
              ])
            ) : (
              <>
                <th>限界水深 (m)</th>
                <th>等流水深 (m)</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {analysis.run.profile.rows.map((r, i) => (
            <tr key={i}>
              <td>{f(r.chainage, 0)}</td>
              <td>{f(r.bed_elevation, 3)}</td>
              <td className="water-value">{f(r.water_elevation, 3)}</td>
              <td>{f(r.depth, 3)}</td>
              <td>{f(r.velocity, 3)}</td>
              <td>
                <span className="fr-badge">{f(r.froude, 3)}</span>
              </td>
              {comparisons ? (
                analysis.comparisons.flatMap((c, j) => [
                  <td key={`${j}-stage`}>
                    {f(c.profile.rows[i].water_elevation, 3)} /{' '}
                    {f(c.profile.rows[i].water_elevation - r.water_elevation, 3)}
                  </td>,
                  <td key={`${j}-cut`}>
                    {c.cut_areas === null ? '未算定' : f(c.cut_areas[i], 3)}
                  </td>,
                ])
              ) : (
                <>
                  <td>{f(r.critical_depth, 3)}</td>
                  <td>{f(r.normal_depth, 3)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
