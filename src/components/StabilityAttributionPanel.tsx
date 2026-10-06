import { Button, Callout, Tag } from '@blueprintjs/core';
import { useMemo } from 'react';
import type {
  Container,
  MetricContribution,
  RestowAction,
  Slot,
  StabilityAttribution,
  StabilityBreach,
} from '../types/shipping';

interface StabilityAttributionPanelProps {
  attribution: StabilityAttribution;
  containers: Container[];
  onApplyAction: (action: RestowAction) => void;
  onLocate: (slot: Slot, containerId: string | null) => void;
}

export function StabilityAttributionPanel({
  attribution,
  containers,
  onApplyAction,
  onLocate,
}: StabilityAttributionPanelProps) {
  const containerMap = useMemo(
    () => new Map(containers.map((container) => [container.id, container])),
    [containers],
  );

  return (
    <section className="panel attribution-panel">
      <header className="panel-heading">
        <div>
          <span className="eyebrow">箱级力矩归因</span>
          <h2>稳性超限处理</h2>
        </div>
        <Tag minimal intent="danger">
          {attribution.breaches.filter((breach) => breach.severity === 'danger').length} 项超限
        </Tag>
      </header>
      <div className="attribution-list">
        {attribution.breaches.map((breach) => (
          <BreachCard
            key={breach.metric}
            breach={breach}
            containerMap={containerMap}
            onApplyAction={onApplyAction}
            onLocate={onLocate}
          />
        ))}
      </div>
      <footer className="attribution-footer">
        指纹 {attribution.fingerprint} · {new Date(attribution.computedAt).toLocaleTimeString('zh-CN')} 重算
        · 格位或港序变化后旧归因自动失效
      </footer>
    </section>
  );
}

function BreachCard({
  breach,
  containerMap,
  onApplyAction,
  onLocate,
}: {
  breach: StabilityBreach;
  containerMap: Map<string, Container>;
  onApplyAction: (action: RestowAction) => void;
  onLocate: (slot: Slot, containerId: string | null) => void;
}) {
  return (
    <article className={`breach-card breach-card--${breach.severity}`}>
      <header className="breach-card__head">
        <strong>{breach.label}</strong>
        <span className="breach-card__value">
          {breach.value.toFixed(2)} / {breach.limit.toFixed(2)} {breach.unit}
        </span>
        <Tag minimal intent={breach.status === 'actionable' ? 'primary' : 'warning'}>
          {breach.status === 'actionable' ? `可落地调箱 ${breach.actions.length} 条` : '待人工处理'}
        </Tag>
      </header>

      {breach.topContributors.length > 0 && (
        <div className="breach-contributors">
          <span className="breach-section-label">影响最大的集装箱</span>
          {breach.topContributors.map((contribution, index) => (
            <ContributorRow
              key={contribution.containerId}
              rank={index + 1}
              contribution={contribution}
              container={containerMap.get(contribution.containerId)}
              onLocate={onLocate}
            />
          ))}
        </div>
      )}

      {breach.actions.length > 0 && (
        <div className="breach-actions">
          <span className="breach-section-label">调箱动作（执行后回到限值内）</span>
          {breach.actions.map((action) => {
            const container = containerMap.get(action.containerId);
            return (
              <div key={action.id} className="breach-action">
                <button
                  type="button"
                  className="breach-action__route"
                  onClick={() => onLocate(action.from, action.containerId)}
                >
                  <strong>{container?.number ?? action.containerId}</strong>
                  <span>
                    贝 {action.from.bayId}/{String(action.from.row).padStart(2, '0')}/{action.from.tier}
                    {' → '}
                    贝 {action.to.bayId}/{String(action.to.row).padStart(2, '0')}/{action.to.tier}
                  </span>
                  <em>
                    调后 {breach.label} {action.metricAfter.toFixed(2)} {breach.unit}
                  </em>
                </button>
                <Button small intent="primary" icon="swap-horizontal" onClick={() => onApplyAction(action)}>
                  执行
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {breach.queued.length > 0 && (
        <div className="breach-queued">
          排队待人工：
          {breach.queued.map((entry) => containerMap.get(entry.containerId)?.number ?? entry.containerId).join('、')}
          （可用落点不足或受约束）
        </div>
      )}

      {breach.status === 'manual' && breach.manualReason && (
        <Callout compact intent="warning" className="breach-manual">
          待人工处理：{breach.manualReason}
        </Callout>
      )}
    </article>
  );
}

function ContributorRow({
  rank,
  contribution,
  container,
  onLocate,
}: {
  rank: number;
  contribution: MetricContribution;
  container: Container | undefined;
  onLocate: (slot: Slot, containerId: string | null) => void;
}) {
  return (
    <button
      type="button"
      className="contributor-row"
      onClick={() => onLocate(contribution.slot, contribution.containerId)}
    >
      <span className="contributor-row__rank">{rank}</span>
      <span className="contributor-row__main">
        <strong>{container?.number ?? contribution.containerId}</strong>
        <span>
          贝 {contribution.slot.bayId}/{String(contribution.slot.row).padStart(2, '0')}/{contribution.slot.tier}
          {container ? ` · ${container.grossWeight.toFixed(1)} t` : ''}
        </span>
      </span>
      <span className="contributor-row__moment">
        {contribution.moment >= 0 ? '+' : ''}
        {contribution.moment.toFixed(1)} t·m
      </span>
      <span className="contributor-row__share">
        <i style={{ width: `${Math.max(6, Math.round(contribution.share * 100))}%` }} />
        {(contribution.share * 100).toFixed(0)}%
      </span>
    </button>
  );
}
