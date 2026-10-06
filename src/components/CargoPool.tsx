import { Button, HTMLSelect, InputGroup, Tag } from '@blueprintjs/core';
import { useMemo, useState } from 'react';
import type { Container, Placement, Port } from '../types/shipping';
import { classLabel } from '../utils/stowageRules';

interface CargoPoolProps {
  containers: Container[];
  placements: Placement[];
  ports: Port[];
  selectedContainerId: string | null;
  onSelect: (containerId: string | null) => void;
  onAutoStow: () => void;
}

export function CargoPool({
  containers,
  placements,
  ports,
  selectedContainerId,
  onSelect,
  onAutoStow,
}: CargoPoolProps) {
  const [query, setQuery] = useState('');
  const [portFilter, setPortFilter] = useState('all');
  const [hazardOnly, setHazardOnly] = useState(false);
  const placedIds = useMemo(() => new Set(placements.map((placement) => placement.containerId)), [placements]);
  const portMap = useMemo(() => new Map(ports.map((port) => [port.code, port])), [ports]);
  const filtered = containers.filter((container) => {
    const normalized = query.trim().toLowerCase();
    const queryMatch =
      !normalized ||
      container.number.toLowerCase().includes(normalized) ||
      container.cargo.includes(normalized);
    const portMatch = portFilter === 'all' || container.portCode === portFilter;
    const hazardMatch = !hazardOnly || container.hazardClass !== 'none';
    return queryMatch && portMatch && hazardMatch;
  });
  const unplacedCount = containers.filter((container) => !placedIds.has(container.id)).length;

  return (
    <section className="panel cargo-pool">
      <header className="panel-heading">
        <div>
          <span className="eyebrow">待配集装箱</span>
          <h2>货物池</h2>
        </div>
        <Tag minimal intent="primary">{unplacedCount} 未配</Tag>
      </header>
      <div className="cargo-filters">
        <InputGroup
          leftIcon="search"
          value={query}
          onValueChange={setQuery}
          placeholder="箱号或货名"
          round
        />
        <HTMLSelect value={portFilter} onChange={(event) => setPortFilter(event.currentTarget.value)}>
          <option value="all">全部目的港</option>
          {ports.map((port) => (
            <option key={port.code} value={port.code}>
              {port.name} / {port.code}
            </option>
          ))}
        </HTMLSelect>
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={hazardOnly}
            onChange={(event) => setHazardOnly(event.currentTarget.checked)}
          />
          仅看危险品
        </label>
      </div>
      <div className="cargo-list">
        {filtered.map((container) => {
          const placed = placedIds.has(container.id);
          const selected = selectedContainerId === container.id;
          const port = portMap.get(container.portCode);
          return (
            <button
              key={container.id}
              type="button"
              className={`cargo-card ${selected ? 'is-selected' : ''} ${placed ? 'is-placed' : ''}`}
              draggable
              onClick={() => onSelect(selected ? null : container.id)}
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-container-id', container.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
            >
              <span className="cargo-card__bar" style={{ background: container.hazardClass !== 'none' ? '#b42318' : port?.color }} />
              <span className="cargo-card__main">
                <span className="cargo-card__top">
                  <strong>{container.number}</strong>
                  {placed && <Tag minimal intent="success">已配</Tag>}
                </span>
                <span className="cargo-card__meta">
                  {container.type} · {container.grossWeight.toFixed(2)} t · {container.reefer ? '冷藏' : '普通'}
                </span>
                <span className="cargo-card__meta">
                  {port?.name}（{container.portCode}） · {classLabel(container.hazardClass)}
                </span>
              </span>
            </button>
          );
        })}
        {filtered.length === 0 && <div className="empty-list">没有符合条件的集装箱。</div>}
      </div>
      <footer className="cargo-actions">
        <Button icon="automatic-updates" intent="primary" fill onClick={onAutoStow}>
          自动配载未装箱
        </Button>
      </footer>
    </section>
  );
}
