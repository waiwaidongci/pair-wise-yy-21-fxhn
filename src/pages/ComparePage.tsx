import { Button, Callout, Divider, ProgressBar, Tag, Tooltip } from '@blueprintjs/core';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { plannerActions } from '../stores/plannerSlice';
import { useAppDispatch, useAppSelector } from '../stores/hooks';
import { downloadManifest } from '../utils/exporters';
import { calculateStability } from '../utils/stability';
import { computeStabilityAttribution } from '../utils/stabilityAttribution';
import { validateStowage } from '../utils/stowageRules';

export function ComparePage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const planner = useAppSelector((state) => state.planner);
  const rows = useMemo(
    () =>
      planner.plans.map((plan) => {
        const stability = calculateStability(plan.placements, planner.containers, planner.bays, planner.vessel);
        const attribution = computeStabilityAttribution(
          plan.placements,
          planner.containers,
          planner.bays,
          planner.vessel,
          planner.ports,
        );
        const conflicts = validateStowage(
          plan.placements,
          planner.containers,
          planner.bays,
          planner.ports,
          attribution,
        );
        return { plan, stability, attribution, conflicts };
      }),
    [planner],
  );
  const finalPlan = planner.plans.find((plan) => plan.status === 'final');

  return (
    <div className="compare-page">
      <header className="compare-header">
        <div>
          <span className="eyebrow">试算结果</span>
          <h1>配载方案并排对比</h1>
          <p>比较不同配载顺序下的吃水、纵横倾、GM 和规则异常，选定后可返回编辑或直接确认。</p>
        </div>
        <div className="compare-actions">
          <Button icon="add" outlined onClick={() => dispatch(plannerActions.duplicatePlan(planner.activePlanId))}>
            复制当前方案
          </Button>
          <Button icon="edit" intent="primary" onClick={() => navigate('/planner')}>
            返回配载编辑
          </Button>
        </div>
      </header>

      {finalPlan && (
        <Callout intent="success" icon="endorsed" className="final-plan-callout">
          最终方案：{finalPlan.name}，已记录 {finalPlan.placements.length} 个集装箱。
        </Callout>
      )}

      <div className="compare-table-wrap">
        <table className="compare-table">
          <thead>
            <tr>
              <th>指标 / 方案</th>
              {rows.map(({ plan, stability, attribution, conflicts }) => {
                const blockingCount = attribution.breaches.filter(
                  (breach) => breach.severity === 'danger',
                ).length;
                return (
                <th key={plan.id} className={plan.id === planner.activePlanId ? 'is-active' : ''}>
                  <div>
                    <Tag minimal intent={plan.status === 'final' ? 'success' : 'none'}>
                      {plan.status === 'final' ? '最终' : '试算'}
                    </Tag>
                    <strong>{plan.name}</strong>
                    <small>{plan.placements.length} 箱</small>
                  </div>
                  <div className="compare-plan-actions">
                    <Button
                      small
                      minimal
                      icon="edit"
                      onClick={() => {
                        dispatch(plannerActions.setActivePlan(plan.id));
                        navigate('/planner');
                      }}
                    >
                      编辑
                    </Button>
                    <Button
                      small
                      minimal
                      icon="download"
                      onClick={() =>
                        downloadManifest(plan, planner.containers, planner.ports, stability, attribution)
                      }
                    >
                      清单
                    </Button>
                    <Tooltip
                      compact
                      disabled={blockingCount === 0}
                      content={`存在 ${blockingCount} 项未处理的稳性超限，请回到配载页按归因处理或转人工放行`}
                    >
                      <Button
                        small
                        minimal
                        intent={plan.status === 'final' ? 'success' : 'none'}
                        icon="endorsed"
                        disabled={plan.status === 'final' || blockingCount > 0}
                        onClick={() => dispatch(plannerActions.confirmPlan({ planId: plan.id }))}
                      >
                        确认
                      </Button>
                    </Tooltip>
                  </div>
                  {conflicts.some((conflict) => conflict.severity === 'danger') && (
                    <span className="compare-risk">存在严重异常</span>
                  )}
                  {blockingCount > 0 && (
                    <span className="compare-risk">{blockingCount} 项稳性超限待处理</span>
                  )}
                </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <CompareRow label="已配箱数" values={rows.map(({ plan }) => String(plan.placements.length))} />
            <CompareRow
              label="货物重量"
              values={rows.map(({ stability }) => `${stability.loadWeight.toFixed(1)} t`)}
            />
            <CompareRow
              label="平均吃水"
              values={rows.map(({ stability }) => `${stability.meanDraft.toFixed(3)} m`)}
            />
            <CompareRow
              label="首 / 尾吃水"
              values={rows.map(
                ({ stability }) => `${stability.draftFore.toFixed(2)} / ${stability.draftAft.toFixed(2)} m`,
              )}
            />
            <CompareRow
              label="横倾"
              values={rows.map(({ stability }) => `${stability.heel.toFixed(2)}°`)}
            />
            <CompareRow
              label="纵倾"
              values={rows.map(({ stability }) => `${stability.trim.toFixed(3)} m`)}
            />
            <CompareRow
              label="GM"
              values={rows.map(({ stability }) => `${stability.gm.toFixed(3)} m`)}
            />
            <CompareRow
              label="KG / KM"
              values={rows.map(({ stability }) => `${stability.kg.toFixed(2)} / ${(stability.gm + stability.kg).toFixed(2)} m`)}
            />
            <CompareRow
              label="严重异常"
              values={rows.map(
                ({ conflicts }) => `${conflicts.filter((conflict) => conflict.severity === 'danger').length} 项`,
              )}
              danger={rows.map(({ conflicts }) => conflicts.some((conflict) => conflict.severity === 'danger'))}
            />
            <CompareRow
              label="全部异常"
              values={rows.map(({ conflicts }) => `${conflicts.length} 项`)}
            />
            <CompareRow
              label="稳性余量"
              values={rows.map(({ stability }) =>
                stability.status === 'stable'
                  ? '满足标准'
                  : stability.status === 'warning'
                    ? '余量偏小'
                    : '超限',
              )}
            />
            <tr>
              <th>稳性评分</th>
              {rows.map(({ plan, stability, conflicts }) => {
                const score = Math.max(
                  0,
                  Math.round(
                    100 -
                      Math.abs(stability.heel) * 6 -
                      Math.abs(stability.trim) * 8 -
                      conflicts.length * 1.8 -
                      (stability.status === 'danger' ? 28 : stability.status === 'warning' ? 10 : 0),
                  ),
                );
                return (
                  <td key={plan.id}>
                    <div className="score-cell">
                      <strong>{score}</strong>
                      <ProgressBar
                        value={score / 100}
                        intent={score >= 85 ? 'success' : score >= 70 ? 'warning' : 'danger'}
                        stripes={false}
                      />
                    </div>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <section className="compare-notes">
        <h2>调整建议</h2>
        <div className="compare-note-grid">
          {rows.map(({ plan, stability, conflicts }) => (
            <article key={plan.id}>
              <header>
                <strong>{plan.name}</strong>
                <Tag minimal>{plan.placements.length} 箱</Tag>
              </header>
              <p>{plan.note}</p>
              {stability.issues.length || conflicts.length ? (
                <ul>
                  {stability.issues.slice(0, 2).map((issue) => (
                    <li key={issue.metric}>{issue.message}</li>
                  ))}
                  {conflicts.slice(0, 2).map((conflict) => (
                    <li key={conflict.id}>{conflict.suggestion}</li>
                  ))}
                </ul>
              ) : (
                <Callout intent="success" compact>
                  当前方案未见明显异常。
                </Callout>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function CompareRow({
  label,
  values,
  danger,
}: {
  label: string;
  values: string[];
  danger?: boolean[];
}) {
  return (
    <tr>
      <th>{label}</th>
      {values.map((value, index) => (
        <td key={`${label}:${index}`} className={danger?.[index] ? 'is-danger' : ''}>
          {value}
        </td>
      ))}
    </tr>
  );
}
