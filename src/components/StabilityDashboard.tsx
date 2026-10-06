import { Callout, ProgressBar, Tag, Tooltip } from '@blueprintjs/core';
import type { StabilityResult } from '../types/shipping';

interface StabilityDashboardProps {
  stability: StabilityResult;
}

export function StabilityDashboard({ stability }: StabilityDashboardProps) {
  const intent =
    stability.status === 'danger' ? 'danger' : stability.status === 'warning' ? 'warning' : 'success';
  const heelPercent = Math.min(100, (Math.abs(stability.heel) / 3) * 100);
  const trimPercent = Math.min(100, (Math.abs(stability.trim) / 1.2) * 100);

  return (
    <section className="panel stability-panel">
      <header className="panel-heading">
        <div>
          <span className="eyebrow">实时计算</span>
          <h2>稳性校核</h2>
        </div>
        <Tag intent={intent} minimal>
          {stability.status === 'stable' ? '稳性正常' : stability.status === 'warning' ? '注意余量' : '超出范围'}
        </Tag>
      </header>
      <div className="stability-grid">
        <Metric label="平均吃水" value={stability.meanDraft.toFixed(2)} unit="m" />
        <Metric label="初稳性 GM" value={stability.gm.toFixed(2)} unit="m" />
        <Metric label="横倾" value={stability.heel.toFixed(2)} unit="°" warning={Math.abs(stability.heel) > 2.1} />
        <Metric label="纵倾" value={stability.trim.toFixed(2)} unit="m" warning={Math.abs(stability.trim) > 0.9} />
      </div>
      <div className="draft-profile">
        <div className="draft-profile__labels">
          <span>首吃水 <strong>{stability.draftFore.toFixed(3)} m</strong></span>
          <span>尾吃水 <strong>{stability.draftAft.toFixed(3)} m</strong></span>
        </div>
        <div className="ship-profile">
          <span className="ship-profile__bow" />
          <span
            className="ship-profile__water"
            style={{ transform: `rotate(${Math.max(-4, Math.min(4, stability.trim * 3))}deg)` }}
          />
          <span className="ship-profile__stern" />
        </div>
      </div>
      <div className="limit-bars">
        <div>
          <span>
            <span>横倾限值</span>
            <strong>{Math.abs(stability.heel).toFixed(2)} / 3.00°</strong>
          </span>
          <ProgressBar intent={heelPercent > 85 ? 'danger' : heelPercent > 65 ? 'warning' : 'success'} value={heelPercent / 100} stripes={false} />
        </div>
        <div>
          <span>
            <span>纵倾限值</span>
            <strong>{Math.abs(stability.trim).toFixed(2)} / 1.20 m</strong>
          </span>
          <ProgressBar intent={trimPercent > 85 ? 'danger' : trimPercent > 65 ? 'warning' : 'success'} value={trimPercent / 100} stripes={false} />
        </div>
      </div>
      <div className="moment-grid">
        <Moment label="排水量" value={`${stability.displacement.toFixed(0)} t`} />
        <Moment label="货重" value={`${stability.loadWeight.toFixed(1)} t`} />
        <Moment label="KG" value={`${stability.kg.toFixed(2)} m`} />
        <Moment label="LCG / LCB" value={`${stability.lcg.toFixed(2)} / ${stability.lcb.toFixed(2)} m`} />
        <Moment label="横向重心" value={`${stability.tcg.toFixed(3)} m`} />
        <Moment label="垂向重心" value={`${stability.vcg.toFixed(2)} m`} />
      </div>
      {stability.issues.length > 0 ? (
        <div className="stability-issues">
          {stability.issues.map((issue) => (
            <Callout key={`${issue.metric}:${issue.message}`} intent={issue.severity === 'danger' ? 'danger' : 'warning'} compact>
              {issue.message}
            </Callout>
          ))}
        </div>
      ) : (
        <Callout intent="success" icon="tick-circle" compact>
          当前重量分布满足公司稳性标准，可继续配载。
        </Callout>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  unit,
  warning,
}: {
  label: string;
  value: string;
  unit: string;
  warning?: boolean;
}) {
  return (
    <div className={`metric-card ${warning ? 'is-warning' : ''}`}>
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
    </div>
  );
}

function Moment({ label, value }: { label: string; value: string }) {
  return (
    <Tooltip content={`${label}：${value}`} compact>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </Tooltip>
  );
}
