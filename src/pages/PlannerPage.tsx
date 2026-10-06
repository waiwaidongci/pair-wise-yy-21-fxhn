import {
  Button,
  Callout,
  Dialog,
  Divider,
  EditableText,
  Intent,
  Tag,
  Tooltip,
} from '@blueprintjs/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BayCanvas } from '../components/BayCanvas';
import type { BayCanvasHandle } from '../components/BayCanvas';
import { CargoPool } from '../components/CargoPool';
import { ConflictList } from '../components/ConflictList';
import { StabilityAttributionPanel } from '../components/StabilityAttributionPanel';
import { StabilityDashboard } from '../components/StabilityDashboard';
import { plannerActions } from '../stores/plannerSlice';
import { useAppDispatch, useAppSelector } from '../stores/hooks';
import { useStabilityAttribution } from '../stores/useStabilityAttribution';
import type { Placement, Slot, StabilityMetricKey, StowageConflict } from '../types/shipping';
import { downloadManifest } from '../utils/exporters';
import { calculateStability } from '../utils/stability';
import { attributionConflicts } from '../utils/stabilityAttribution';
import { findAutoStowPlacements } from '../utils/stowage';
import { validateStowage } from '../utils/stowageRules';

export function PlannerPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const planner = useAppSelector((state) => state.planner);
  const canvasRef = useRef<BayCanvasHandle>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const activePlan = planner.plans.find((plan) => plan.id === planner.activePlanId) ?? planner.plans[0];
  const stability = useMemo(
    () =>
      activePlan
        ? calculateStability(activePlan.placements, planner.containers, planner.bays, planner.vessel)
        : null,
    [activePlan, planner.containers, planner.bays, planner.vessel],
  );
  const attribution = useStabilityAttribution(activePlan, planner.containers, planner.bays, planner.ports, planner.vessel);
  const ruleConflicts = useMemo(
    () =>
      activePlan && stability
        ? validateStowage(activePlan.placements, planner.containers, planner.bays, planner.ports)
        : [],
    [activePlan, planner.containers, planner.bays, planner.ports, stability],
  );
  const stabilityConflicts = useMemo(
    () => (attribution ? attributionConflicts(attribution) : []),
    [attribution],
  );
  const conflicts = useMemo(
    () => [...ruleConflicts, ...stabilityConflicts],
    [ruleConflicts, stabilityConflicts],
  );
  const selectedPlacement = useMemo(() => {
    if (!activePlan || !planner.selectedContainerId) return null;
    return activePlan.placements.find((placement) => placement.containerId === planner.selectedContainerId) ?? null;
  }, [activePlan, planner.selectedContainerId]);
  const unplacedCount = activePlan
    ? planner.containers.length - activePlan.placements.length
    : planner.containers.length;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, [contenteditable="true"]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) dispatch(plannerActions.redo());
        else dispatch(plannerActions.undo());
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedPlacement) {
        dispatch(plannerActions.removePlacement(selectedPlacement.id));
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch, selectedPlacement]);

  if (!activePlan || !stability) {
    return <div className="page-loading">正在读取配载方案…</div>;
  }

  function assignContainer(containerId: string, slot: Slot) {
    dispatch(plannerActions.assignContainer({ containerId, slot }));
  }

  function selectPlacement(placement: Placement) {
    dispatch(plannerActions.selectContainer(placement.containerId));
    dispatch(
      plannerActions.selectSlot({
        bayId: placement.bayId,
        row: placement.row,
        tier: placement.tier,
      }),
    );
  }

  function handleAutoStow() {
    const newPlacements = findAutoStowPlacements(
      planner.containers,
      activePlan.placements,
      planner.bays,
    );
    dispatch(plannerActions.autoStow(newPlacements));
  }

  function focusConflict(conflict: StowageConflict) {
    dispatch(plannerActions.setHighlightedConflict(conflict.id));
    if (conflict.containerIds[0]) {
      dispatch(plannerActions.selectContainer(conflict.containerIds[0]));
    }
    dispatch(plannerActions.selectSlot(conflict.slot));
  }

  function applyAttributionMove(containerId: string, to: Slot) {
    dispatch(plannerActions.assignContainer({ containerId, slot: to }));
  }

  function toggleManual(metric: StabilityMetricKey, manual: boolean) {
    if (!activePlan) return;
    dispatch(plannerActions.setManualOverride({ planId: activePlan.id, metric, manual }));
  }

  function locateContainer(containerId: string, slot: Slot) {
    dispatch(plannerActions.selectContainer(containerId));
    dispatch(plannerActions.selectSlot(slot));
  }

  function exportManifest() {
    downloadManifest(activePlan, planner.containers, planner.ports, stability!, attribution);
  }

  const conflictIntent: Intent =
    conflicts.some((conflict) => conflict.severity === 'danger')
      ? 'danger'
      : conflicts.length
        ? 'warning'
        : 'success';

  return (
    <div className="planner-page">
      <div className="planner-toolbar">
        <div className="vessel-summary">
          <span className="eyebrow">当前船舶 / 航次</span>
          <strong>
            {planner.vessel.name}
            <small>{planner.vessel.voyage}</small>
          </strong>
          <span>
            {planner.vessel.lengthOverall.toFixed(1)} m · {planner.vessel.breadth.toFixed(1)} m · {planner.vessel.imo}
          </span>
        </div>
        <div className="toolbar-stat">
          <small>已配箱</small>
          <strong>{activePlan.placements.length}</strong>
          <span>/ {planner.containers.length}</span>
        </div>
        <div className="toolbar-stat">
          <small>未配箱</small>
          <strong>{unplacedCount}</strong>
        </div>
        <div className="toolbar-stat">
          <small>异常项</small>
          <strong className={conflictIntent === 'danger' ? 'text-danger' : ''}>{conflicts.length}</strong>
        </div>
        <div className="toolbar-spacer" />
        <Tooltip content="撤销上一步（⌘Z）" compact>
          <Button
            icon="undo"
            minimal
            disabled={planner.past.length === 0}
            onClick={() => dispatch(plannerActions.undo())}
          />
        </Tooltip>
        <Tooltip content="重做（⇧⌘Z）" compact>
          <Button
            icon="redo"
            minimal
            disabled={planner.future.length === 0}
            onClick={() => dispatch(plannerActions.redo())}
          />
        </Tooltip>
        <Divider />
        <Button icon="automatic-updates" onClick={handleAutoStow}>
          自动配载
        </Button>
        <Button
          icon="duplicate"
          outlined
          onClick={() => dispatch(plannerActions.duplicatePlan(activePlan.id))}
        >
          新建试算
        </Button>
        <Button icon="comparison" outlined onClick={() => navigate('/compare')}>
          方案对比
        </Button>
      </div>

      <div className="plan-tabs">
        <span className="plan-tabs__label">配载方案</span>
        {planner.plans.map((plan) => (
          <button
            key={plan.id}
            type="button"
            className={`plan-tab ${plan.id === planner.activePlanId ? 'is-active' : ''}`}
            onClick={() => dispatch(plannerActions.setActivePlan(plan.id))}
          >
            <span>
              <strong>{plan.name}</strong>
              <small>{plan.placements.length} 箱</small>
            </span>
            <Tag minimal intent={plan.status === 'final' ? 'success' : 'none'}>
              {plan.status === 'final' ? '最终' : '试算'}
            </Tag>
          </button>
        ))}
        <div className="plan-tabs__spacer" />
        <span className="save-state">
          <span className="save-state__dot" />
          自动保存 · {new Date(activePlan.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      <main className="planner-workspace">
        <CargoPool
          containers={planner.containers}
          placements={activePlan.placements}
          ports={planner.ports}
          selectedContainerId={planner.selectedContainerId}
          onSelect={(containerId) => dispatch(plannerActions.selectContainer(containerId))}
          onAutoStow={handleAutoStow}
        />

        <section className="panel bay-panel">
          <header className="panel-heading bay-panel__heading">
            <div>
              <span className="eyebrow">Canvas 贝位图</span>
              <h2>货物格位分配</h2>
            </div>
            <div className="bay-actions">
              <EditableText
                value={activePlan.name}
                onChange={(name) => dispatch(plannerActions.renamePlan({ planId: activePlan.id, name }))}
                selectAllOnFocus
              />
              <Button
                icon="trash"
                minimal
                intent="danger"
                onClick={() => dispatch(plannerActions.clearPlan())}
              >
                清空
              </Button>
            </div>
          </header>
          <div className="bay-instructions">
            <span>
              <i className="legend-box legend-box--selected" />
              当前选择
            </span>
            <span>
              <i className="legend-box legend-box--danger" />
              严重异常
            </span>
            <span>
              <i className="legend-box legend-box--warning" />
              规则提醒
            </span>
            <span>
              拖动左侧集装箱到格位，或先选箱再点击空格位
            </span>
          </div>
          <BayCanvas
            ref={canvasRef}
            bays={planner.bays}
            placements={activePlan.placements}
            containers={planner.containers}
            ports={planner.ports}
            conflicts={conflicts}
            selectedContainerId={planner.selectedContainerId}
            selectedSlot={planner.selectedSlot}
            highlightedConflictId={planner.highlightedConflictId}
            onSlotAssigned={assignContainer}
            onSlotSelected={(slot) => dispatch(plannerActions.selectSlot(slot))}
            onPlacementSelected={selectPlacement}
            onPlacementRemoved={(placementId) => dispatch(plannerActions.removePlacement(placementId))}
          />
          <footer className="bay-footer">
            <div className="bay-footer__selection">
              <strong>当前格位</strong>
              <span>
                {planner.selectedSlot
                  ? `贝 ${planner.selectedSlot.bayId} / ${String(planner.selectedSlot.row).padStart(2, '0')} 排 / ${planner.selectedSlot.tier} 层`
                  : '未选择'}
              </span>
            </div>
            <div className="bay-footer__notice">
              <span className={`notice-dot notice-dot--${stability.status}`} />
              {planner.notice ?? '所有调整都会立即重算稳性、隔离和堆叠规则'}
            </div>
            <div className="bay-export-actions">
              <Button icon="media" onClick={() => canvasRef.current?.downloadPng()}>
                导出配载图
              </Button>
              <Button icon="th" onClick={exportManifest}>
                导出配载清单
              </Button>
              <Button intent="primary" icon="endorsed" onClick={() => setConfirmOpen(true)}>
                定为最终方案
              </Button>
            </div>
          </footer>
        </section>

        <section className="planner-right">
          <StabilityDashboard stability={stability} />
          {attribution && (
            <StabilityAttributionPanel
              attribution={attribution}
              containers={planner.containers}
              onApplyMove={applyAttributionMove}
              onToggleManual={toggleManual}
              onLocate={locateContainer}
            />
          )}
          <ConflictList
            conflicts={conflicts}
            containers={planner.containers}
            highlightedConflictId={planner.highlightedConflictId}
            onSelectConflict={focusConflict}
          />
        </section>
      </main>

      <Dialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="确认最终配载方案"
        icon="endorsed"
        className="confirm-dialog"
      >
        <div className="dialog-body">
          <p>
            将把 <strong>{activePlan.name}</strong> 标记为最终方案。当前共配载
            <strong> {activePlan.placements.length} </strong>个集装箱，剩余{unplacedCount}个未配箱。
          </p>
          <div className="dialog-summary">
            <div>
              <span>平均吃水</span>
              <strong>{stability.meanDraft.toFixed(3)} m</strong>
            </div>
            <div>
              <span>横倾 / 纵倾</span>
              <strong>
                {stability.heel.toFixed(2)}° / {stability.trim.toFixed(2)} m
              </strong>
            </div>
            <div>
              <span>GM</span>
              <strong>{stability.gm.toFixed(3)} m</strong>
            </div>
            <div>
              <span>严重异常</span>
              <strong>{conflicts.filter((conflict) => conflict.severity === 'danger').length} 项</strong>
            </div>
          </div>
          {attribution?.hasDanger && (
            <Callout intent="danger" icon="warning-sign" className="dialog-warning">
              当前仍有 {attribution.unhandledDanger.length} 项稳性超限未处理
              （{attribution.unhandledDanger.map((m) => attribution.metrics[m].label).join('、')}）。
              请按归因面板调整箱量，或标记待人工处理后再确认。
            </Callout>
          )}
        </div>
        <div className="dialog-footer">
          <Button onClick={() => setConfirmOpen(false)}>返回调整</Button>
          <Button
            intent="primary"
            icon="tick"
            disabled={attribution?.hasDanger}
            onClick={() => {
              dispatch(plannerActions.confirmPlan(activePlan.id));
              setConfirmOpen(false);
            }}
          >
            确认最终方案
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
