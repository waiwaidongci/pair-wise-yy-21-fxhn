import { Button, Callout, Icon, Tag, Tooltip } from '@blueprintjs/core';
import { useMemo, useState } from 'react';
import type { Container, Slot, StabilityMetricKey } from '../types/shipping';
import type { MetricAttribution, StabilityAttribution } from '../utils/stabilityAttribution';
import { classLabel } from '../utils/stowageRules';

interface StabilityAttributionPanelProps {
  attribution: StabilityAttribution;
  containers: Container[];
  onApplyMove: (containerId: string, to: Slot) => void;
  onToggleManual: (metric: StabilityMetricKey, manual: boolean) => void;
  onLocate: (containerId: string, slot: Slot) => void;
}

const METRIC_ORDER: StabilityMetricKey[] = ['trim', 'heel', 'gm'];

export function StabilityAttributionPanel({
  attribution,
  containers,
  onApplyMove,
  onToggleManual,
  onLocate,
}: StabilityAttributionPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const containerMap = useMemo(
    () => new Map(containers.map((container) => [container.id, container])),
    [containers],
  );

  return (
    <section className="panel attribution-panel">
      <header className="panel-heading">
        <div>
          <span className="eyebrow">按箱归因 · 调箱建议</span>
          <h2>超限归因与处理</h2>
        </div>
        <Tag minimal intent={attribution.hasDanger ? 'danger' : 'success'}>
          {attribution.unhandledDanger.length} 项待处理
        </Tag>
      </header>
      <div className="attribution-list">
        {METRIC_ORDER.map((key) => {
          const metric = attribution.metrics[key];
          const isExpanded = expanded[key] ?? metric.exceeded;
          return (
            <MetricCard
              key={key}
              metric={metric}
              expanded={isExpanded}
              onToggle={() => setExpanded((prev) => ({ ...prev, [key]: !isExpanded }))}
              containerMap={containerMap}
              onApplyMove={onApplyMove}
              onToggleManual={onToggleManual}
              onLocate={onLocate}
            />
          );
        })}
      </div>
    </section>
  );
}

function MetricCard({
  metric,
  expanded,
  onToggle,
  containerMap,
  onApplyMove,
  onToggleManual,
  onLocate,
}: {
  metric: MetricAttribution;
  expanded: boolean;
  onToggle: () => void;
  containerMap: Map<string, Container>;
  onApplyMove: (containerId: string, to: Slot) => void;
  onToggleManual: (metric: StabilityMetricKey, manual: boolean) => void;
  onLocate: (containerId: string, slot: Slot) => void;
}) {
  const danger = metric.exceeded && !metric.manual;
  const warning = metric.exceeded && metric.manual;
  const intent = danger ? 'danger' : warning ? 'warning' : metric.nearLimit ? 'warning' : 'success';
  const statusText = metric.manual
    ? '待人工处理'
    : metric.exceeded
      ? '超限'
      : metric.nearLimit
        ? '接近限值'
        : '正常';
  const valueText = formatValue(metric, metric.value);
  const limitText = formatValue(metric, metric.limit);
  const maxAbs = Math.max(1, ...metric.drivers.map((d) => Math.abs(driverImpact(metric, d))));

  return (
    <div className={`metric-card-v2 metric-card-v2--${intent}`}>
      <button type="button" className="metric-card-v2__head" onClick={onToggle}>
        <div className="metric-card-v2__title">
          <Tag minimal intent={intent}>
            {statusText}
          </Tag>
          <strong>{metric.label}</strong>
        </div>
        <div className="metric-card-v2__value">
          <strong className={danger ? 'text-danger' : ''}>{valueText}</strong>
          <small>/ {limitText}</small>
          <Icon icon={expanded ? 'chevron-up' : 'chevron-down'} />
        </div>
      </button>

      {expanded && (
        <div className="metric-card-v2__body">
          {metric.exceeded && !metric.manual && (
            <Callout intent="danger" compact className="metric-card-v2__callout">
              超出限值 {formatValue(metric, metric.excess)}
              {metric.currentMoment !== 0 && metric.momentBudget !== 0 && (
                <>
                  {' '}
                  · 当前力矩 {metric.currentMoment.toFixed(0)} t·m，预算 {metric.momentBudget.toFixed(0)} t·m
                </>
              )}
            </Callout>
          )}
          {metric.manual && (
            <Callout intent="warning" compact className="metric-card-v2__callout">
              {metric.manualReason}
            </Callout>
          )}

          <div className="driver-list">
            <span className="driver-list__label">影响最大的集装箱（按贡献排序）</span>
            {metric.drivers.length === 0 && (
              <span className="driver-list__empty">当前没有可归因的装载箱。</span>
            )}
            {metric.drivers.slice(0, 5).map((driver) => {
              const container = containerMap.get(driver.containerId);
              const impact = driverImpact(metric, driver);
              return (
                <button
                  type="button"
                  key={driver.containerId}
                  className="driver-row"
                  onClick={() =>
                    onLocate(driver.containerId, { bayId: driver.bayId, row: driver.row, tier: driver.tier })
                  }
                  title="点击在贝位图中定位"
                >
                  <span className="driver-row__main">
                    <strong>{driver.containerNumber}</strong>
                    <small>
                      贝 {driver.bayId} / {String(driver.row).padStart(2, '0')} 排 / {driver.tier} 层
                      {container ? ` · ${classLabel(container.hazardClass)}` : ''}
                      {container?.reefer ? ' · 冷藏' : ''}
                    </small>
                  </span>
                  <span className="driver-row__bar">
                    <span
                      className="driver-row__bar-fill"
                      style={{
                        width: `${Math.min(100, (Math.abs(impact) / maxAbs) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="driver-row__impact">
                    {impact > 0 ? '+' : ''}
                    {impact.toFixed(0)} t·m
                  </span>
                </button>
              );
            })}
          </div>

          {metric.exceeded && !metric.manual && (
            <RemediationBlock metric={metric} onApplyMove={onApplyMove} onToggleManual={onToggleManual} />
          )}
          {metric.exceeded && metric.manual && (
            <div className="metric-card-v2__actions">
              <Button small minimal intent="warning" onClick={() => onToggleManual(metric.metric, false)}>
                撤销待人工标记
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RemediationBlock({
  metric,
  onApplyMove,
  onToggleManual,
}: {
  metric: MetricAttribution;
  onApplyMove: (containerId: string, to: Slot) => void;
  onToggleManual: (metric: StabilityMetricKey, manual: boolean) => void;
}) {
  const best = metric.bestMove;
  const partial = metric.bestPartialMove;

  if (!best) {
    return (
      <Callout intent="warning" compact className="metric-card-v2__callout">
        <strong>无可行自动调箱动作。</strong>
        {metric.manualReason ??
          '在满足目的港顺序、堆重上限、危险品隔离和冷藏层位的前提下，找不到可将本项调回限值内的空位。'}
        {partial && (
          <span className="remediation__partial">
            {' '}
            单次调整最多可使{metric.label}降至 {formatValue(metric, partialAfter(metric, partial))}
            ，仍超限 {formatValue(metric, partialExcess(metric, partial))}，需继续调整或标记人工。
          </span>
        )}
        <div className="metric-card-v2__actions">
          <Button small intent="warning" onClick={() => onToggleManual(metric.metric, true)}>
            标记待人工处理
          </Button>
        </div>
      </Callout>
    );
  }

  const afterValue =
    metric.metric === 'trim'
      ? best.afterTrim
      : metric.metric === 'heel'
        ? best.afterHeel
        : best.afterGm;

  return (
    <div className="remediation">
      <span className="remediation__label">建议调箱动作（应用后立即重算归因）</span>
      <div className="remediation__best">
        <div className="remediation__move">
          <strong>{best.containerNumber}</strong>
          <span>
            从 贝{best.from.bayId}/{String(best.from.row).padStart(2, '0')}排/{best.from.tier}层
          </span>
          <Icon icon="arrow-right" />
          <span>
            移至 贝{best.to.bayId}/{String(best.to.row).padStart(2, '0')}排/{best.to.tier}层
          </span>
        </div>
        <div className="remediation__after">
          调整后{metric.label}将降至 <strong>{formatValue(metric, afterValue)}</strong>
          （限值 {formatValue(metric, metric.limit)}）
        </div>
        <div className="remediation__actions">
          <Button
            small
            intent="primary"
            icon="tick"
            onClick={() => onApplyMove(best.containerId, best.to)}
          >
            应用此调整
          </Button>
          <Tooltip content="应用后所有指标与规则立即重算，旧归因失效" compact>
            <Button small minimal icon="info-sign" />
          </Tooltip>
        </div>
      </div>
      <div className="metric-card-v2__actions">
        <Button small minimal intent="warning" onClick={() => onToggleManual(metric.metric, true)}>
          标记待人工处理
        </Button>
      </div>
    </div>
  );
}

function driverImpact(metric: MetricAttribution, driver: { trimMoment: number; heelMoment: number; vertical: number }): number {
  if (metric.metric === 'trim') return driver.trimMoment;
  if (metric.metric === 'heel') return driver.heelMoment;
  return driver.vertical;
}

function formatValue(metric: MetricAttribution, value: number): string {
  return value.toFixed(metric.unit === '°' ? 2 : 3);
}

function partialAfter(metric: MetricAttribution, move: { afterTrim: number; afterHeel: number; afterGm: number }): number {
  return metric.metric === 'trim' ? move.afterTrim : metric.metric === 'heel' ? move.afterHeel : move.afterGm;
}

function partialExcess(metric: MetricAttribution, move: { afterTrim: number; afterHeel: number; afterGm: number }): number {
  return Math.max(0, Math.abs(partialAfter(metric, move)) - metric.limit);
}
