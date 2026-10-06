import { Button, HTMLSelect, Tag } from '@blueprintjs/core';
import { useMemo, useState } from 'react';
import type { Container, StowageConflict, StowageConflictType } from '../types/shipping';
import { classLabel } from '../utils/stowageRules';

interface ConflictListProps {
  conflicts: StowageConflict[];
  containers: Container[];
  highlightedConflictId: string | null;
  onSelectConflict: (conflict: StowageConflict) => void;
}

export function ConflictList({
  conflicts,
  containers,
  highlightedConflictId,
  onSelectConflict,
}: ConflictListProps) {
  const [filter, setFilter] = useState<StowageConflictType | 'all'>('all');
  const containerMap = useMemo(() => new Map(containers.map((container) => [container.id, container])), [containers]);
  const visible = filter === 'all' ? conflicts : conflicts.filter((conflict) => conflict.type === filter);
  const dangerCount = conflicts.filter((conflict) => conflict.severity === 'danger').length;

  return (
    <section className="panel conflict-panel">
      <header className="panel-heading">
        <div>
          <span className="eyebrow">规则引擎</span>
          <h2>配载异常</h2>
        </div>
        <Tag minimal intent={dangerCount ? 'danger' : conflicts.length ? 'warning' : 'success'}>
          {dangerCount} 严重 / {conflicts.length} 总数
        </Tag>
      </header>
      <div className="conflict-filter">
        <HTMLSelect value={filter} onChange={(event) => setFilter(event.currentTarget.value as StowageConflictType | 'all')}>
          <option value="all">全部问题</option>
          <option value="overweight">超重</option>
          <option value="wrong-port">错港顺序</option>
          <option value="top-heavy">上重下轻</option>
          <option value="segregation">危险品隔离</option>
          <option value="stack-limit">堆重超限</option>
          <option value="stability">稳性异常</option>
        </HTMLSelect>
        <span>点选异常可定位格位</span>
      </div>
      <div className="conflict-list">
        {visible.map((conflict) => (
          <button
            type="button"
            key={conflict.id}
            className={`conflict-item conflict-item--${conflict.severity} ${
              highlightedConflictId === conflict.id ? 'is-active' : ''
            }`}
            onClick={() => onSelectConflict(conflict)}
          >
            <span className="conflict-item__top">
              <Tag minimal intent={conflict.severity === 'danger' ? 'danger' : 'warning'}>
                {conflictLabel(conflict.type)}
              </Tag>
              <span>
                贝 {conflict.slot.bayId} / {String(conflict.slot.row).padStart(2, '0')} / {conflict.slot.tier}
              </span>
            </span>
            <strong>{conflict.title}</strong>
            <p>{conflict.detail}</p>
            {conflict.containerIds.length > 0 && (
              <span className="conflict-boxes">
                {conflict.containerIds.slice(0, 3).map((id) => {
                  const container = containerMap.get(id);
                  return container ? (
                    <span key={id}>
                      {container.number} · {classLabel(container.hazardClass)}
                    </span>
                  ) : null;
                })}
              </span>
            )}
            <span className="conflict-suggestion">{conflict.suggestion}</span>
          </button>
        ))}
        {visible.length === 0 && (
          <CalloutLike text={filter === 'all' ? '当前方案没有配载异常。' : '该分类下没有异常。'} />
        )}
      </div>
    </section>
  );
}

function conflictLabel(type: StowageConflictType): string {
  const labels: Record<StowageConflictType, string> = {
    overweight: '超重',
    'wrong-port': '错港',
    'top-heavy': '堆叠',
    segregation: '隔离',
    'stack-limit': '堆重',
    stability: '稳性',
  };
  return labels[type];
}

function CalloutLike({ text }: { text: string }) {
  return (
    <div className="empty-conflicts">
      <Button icon="endorsed" minimal disabled />
      <span>{text}</span>
    </div>
  );
}
