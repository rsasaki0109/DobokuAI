import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Analysis, Station } from './types';
import { colors, ground, waterExtent } from './types';

export function ProfileChart({
  analysis,
  metric = 'stage',
}: {
  analysis: Analysis;
  metric?: 'stage' | 'depth' | 'velocity';
}) {
  const key = metric === 'stage' ? 'water_elevation' : metric;
  const data = analysis.run.profile.rows.map((row, i) => ({
    x: row.chainage,
    bed: row.bed_elevation,
    base: row[key],
    ...Object.fromEntries(analysis.comparisons.map((c, j) => [`c${j}`, c.profile.rows[i][key]])),
  }));
  const label = metric === 'stage' ? '標高 (m)' : metric === 'depth' ? '水深 (m)' : '流速 (m/s)';
  return (
    <div className="chart" aria-label="縦断計算結果グラフ">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 15, right: 20, bottom: 12, left: 8 }}>
          <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e6eae7" />
          <XAxis
            dataKey="x"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickLine={false}
            axisLine={false}
            label={{ value: '上流 → 下流 / 距離 (m)', position: 'insideBottom', offset: -8 }}
          />
          <YAxis
            domain={metric === 'stage' ? ['dataMin - 0.4', 'dataMax + 0.4'] : [0, 'auto']}
            tickFormatter={(v) => Number(v).toFixed(1)}
            tickLine={false}
            axisLine={false}
            width={58}
            label={{ value: label, angle: -90, position: 'insideLeft' }}
          />
          <Tooltip
            formatter={(value) => `${Number(value).toFixed(3)}`}
            labelFormatter={(v) => `距離 ${v} m`}
          />
          <Legend wrapperStyle={{ paddingTop: 15 }} />
          {metric === 'stage' && (
            <Area
              dataKey="bed"
              name="施工前 河床"
              fill="#e1e5d8"
              stroke="#8b937b"
              fillOpacity={0.65}
              isAnimationActive={false}
            />
          )}
          <Line
            dataKey="base"
            name="施工前"
            stroke="#3a92c4"
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
          {analysis.comparisons.map((c, i) => (
            <Line
              key={i}
              dataKey={`c${i}`}
              name={c.scenario.name}
              stroke={colors[i]}
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SectionChart({
  station,
  analysis,
  index,
  bounds,
  groundLabel,
}: {
  station: Station;
  analysis: Analysis | null;
  index: number;
  bounds?: { xmin: number; xmax: number; ymin: number; ymax: number };
  groundLabel?: string;
}) {
  const g = ground(station.section, station.bed_elevation);
  const series = [{ name: groundLabel ?? '施工前 地盤', points: g, color: '#879077', dashed: false }];
  if (analysis?.run.profile.rows[index]) {
    const stage = analysis.run.profile.rows[index].water_elevation;
    const [lo, hi] = waterExtent(g, stage);
    series.push({
      name: '施工前 水位',
      points: [
        { x: lo, z: stage },
        { x: hi, z: stage },
      ],
      color: '#3a92c4',
      dashed: false,
    });
    analysis.comparisons.forEach((c, i) => {
      const st = c.river.stations[index];
      const gg = ground(st.section, st.bed_elevation);
      const stage = c.profile.rows[index].water_elevation;
      const [lo, hi] = waterExtent(gg, stage);
      series.push({ name: `${c.scenario.name} 地盤`, points: gg, color: colors[i], dashed: true });
      series.push({
        name: `${c.scenario.name} 水位`,
        points: [
          { x: lo, z: stage },
          { x: hi, z: stage },
        ],
        color: colors[i],
        dashed: false,
      });
    });
  }
  const all = series.flatMap((s) => s.points);
  const valid = all.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z));
  if (!valid) return <div className="empty">断面の座標に有限値を入力してください。</div>;
  const ymin = bounds?.ymin ?? Math.min(...all.map((p) => p.z)) - 0.5;
  const ymax = bounds?.ymax ?? Math.max(...all.map((p) => p.z)) + 0.5;
  return (
    <div className="chart section-chart" aria-label="同一基準高の河川横断図">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 15, right: 20, bottom: 15, left: 8 }}>
          <CartesianGrid strokeDasharray="3 5" stroke="#e6eae7" />
          <XAxis
            type="number"
            dataKey="x"
            domain={bounds ? [bounds.xmin, bounds.xmax] : ['dataMin', 'dataMax']}
            tickLine={false}
            axisLine={false}
            label={{ value: '横断距離 (m)', position: 'insideBottom', offset: -8 }}
          />
          <YAxis
            type="number"
            dataKey="z"
            domain={[ymin, ymax]}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => Number(v).toFixed(1)}
            label={{ value: '標高 (m)', angle: -90, position: 'insideLeft' }}
          />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            formatter={(value) => Number(value).toFixed(3)}
          />
          <Legend wrapperStyle={{ paddingTop: 15 }} />
          {series.map((s, i) => (
            <Scatter
              key={i}
              name={s.name}
              data={s.points}
              fill={s.color}
              line={{
                stroke: s.color,
                strokeWidth: 2.5,
                strokeDasharray: s.dashed ? '5 4' : undefined,
              }}
              shape={() => <g />}
              isAnimationActive={false}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
