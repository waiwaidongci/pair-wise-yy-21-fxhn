import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  Bay,
  Container,
  Placement,
  Port,
  Slot,
  StowageConflict,
} from '../types/shipping';

export interface BayCanvasHandle {
  downloadPng: () => void;
}

interface BayCanvasProps {
  bays: Bay[];
  placements: Placement[];
  containers: Container[];
  ports: Port[];
  conflicts: StowageConflict[];
  selectedContainerId: string | null;
  selectedSlot: Slot | null;
  highlightedConflictId: string | null;
  onSlotAssigned: (containerId: string, slot: Slot) => void;
  onSlotSelected: (slot: Slot) => void;
  onPlacementSelected: (placement: Placement) => void;
  onPlacementRemoved: (placementId: string) => void;
}

const PANEL_WIDTH = 218;
const GAP = 20;
const LEFT = 46;
const TOP = 82;
const TIER_HEIGHT = 48;
const ROW_WIDTH = 22;
const CELL_WIDTH = 20;
const CELL_HEIGHT = 43;

export const BayCanvas = forwardRef<BayCanvasHandle, BayCanvasProps>(function BayCanvas(
  {
    bays,
    placements,
    containers,
    ports,
    conflicts,
    selectedContainerId,
    selectedSlot,
    highlightedConflictId,
    onSlotAssigned,
    onSlotSelected,
    onPlacementSelected,
    onPlacementRemoved,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredSlot, setHoveredSlot] = useState<Slot | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const containerMap = useMemo(
    () => new Map(containers.map((container) => [container.id, container])),
    [containers],
  );
  const portMap = useMemo(() => new Map(ports.map((port) => [port.code, port])), [ports]);
  const placementMap = useMemo(
    () => new Map(placements.map((placement) => [slotKey(placement), placement])),
    [placements],
  );
  const conflictSlots = useMemo(() => {
    const map = new Map<string, StowageConflict>();
    conflicts.forEach((conflict) => {
      map.set(slotKey(conflict.slot), conflict);
    });
    return map;
  }, [conflicts]);

  const canvasWidth = bays.length * (PANEL_WIDTH + GAP) + 48;
  const canvasHeight = 478;

  useImperativeHandle(ref, () => ({
    downloadPng() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = '船舶配载图.png';
      link.click();
    },
  }));

  useEffect(() => {
    drawCanvas();
  }, [bays, placements, containers, ports, selectedContainerId, selectedSlot, highlightedConflictId, hoveredSlot, conflictSlots]);

  function drawCanvas() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, canvasWidth, canvasHeight);
    const background = context.createLinearGradient(0, 0, 0, canvasHeight);
    background.addColorStop(0, '#f8fbfd');
    background.addColorStop(1, '#edf3f7');
    context.fillStyle = background;
    context.fillRect(0, 0, canvasWidth, canvasHeight);

    context.fillStyle = '#1b354d';
    context.font = '700 14px "Noto Sans SC", sans-serif';
    context.fillText('船舶贝位配载图', 22, 30);
    context.fillStyle = '#6d7f91';
    context.font = '11px "Noto Sans SC", sans-serif';
    context.fillText('单元格格式：排号 + 层号 · 点击或拖放集装箱到格位 · 右键移除', 154, 30);
    context.fillStyle = '#8494a4';
    context.font = '10px "Noto Sans SC", sans-serif';
    context.fillText('船首', canvasWidth - 64, 56);
    context.beginPath();
    context.moveTo(30, 60);
    context.lineTo(canvasWidth - 30, 60);
    context.strokeStyle = '#b7c5d1';
    context.stroke();
    context.beginPath();
    context.moveTo(canvasWidth - 30, 60);
    context.lineTo(canvasWidth - 39, 55);
    context.lineTo(canvasWidth - 39, 65);
    context.closePath();
    context.fillStyle = '#9aa9b7';
    context.fill();

    bays.forEach((bay, bayIndex) => {
      const panelX = LEFT + bayIndex * (PANEL_WIDTH + GAP);
      drawBayPanel(context, bay, panelX);
    });

    context.fillStyle = '#738496';
    context.font = '10px "Noto Sans SC", sans-serif';
    context.fillText('底舱', 20, canvasHeight - 30);
    context.fillText('上甲板', 20, TOP + 20);

    if (dragOver) {
      context.strokeStyle = '#1676a7';
      context.lineWidth = 2;
      context.setLineDash([6, 5]);
      context.strokeRect(5, 5, canvasWidth - 10, canvasHeight - 10);
      context.setLineDash([]);
    }
  }

  function drawBayPanel(context: CanvasRenderingContext2D, bay: Bay, panelX: number) {
    context.fillStyle = '#ffffff';
    context.strokeStyle = '#c9d5df';
    context.lineWidth = 1;
    context.beginPath();
    context.roundRect(panelX, TOP - 26, PANEL_WIDTH, bay.tiers * TIER_HEIGHT + 58, 7);
    context.fill();
    context.stroke();
    context.fillStyle = '#173b59';
    context.font = '700 13px "Noto Sans SC", sans-serif';
    context.fillText(`BAY ${bay.name}`, panelX + 12, TOP - 6);
    context.fillStyle = '#8090a1';
    context.font = '9px "Noto Sans SC", sans-serif';
    context.fillText(`${bay.rows}R × ${bay.tiers}T`, panelX + 118, TOP - 7);

    for (let row = 1; row <= bay.rows; row += 1) {
      const x = panelX + 12 + (row - 1) * ROW_WIDTH;
      context.fillStyle = '#758699';
      context.font = '8px sans-serif';
      context.textAlign = 'center';
      context.fillText(String(row).padStart(2, '0'), x + CELL_WIDTH / 2, TOP + bay.tiers * TIER_HEIGHT + 15);
      for (let tier = 1; tier <= bay.tiers; tier += 1) {
        const y = TOP + (bay.tiers - tier) * TIER_HEIGHT;
        const slot = { bayId: bay.id, row, tier };
        const key = slotKey(slot);
        const placement = placementMap.get(key);
        const container = placement ? containerMap.get(placement.containerId) : undefined;
        const conflict = conflictSlots.get(key);
        const selected =
          selectedSlot?.bayId === bay.id && selectedSlot.row === row && selectedSlot.tier === tier;
        const hovered =
          hoveredSlot?.bayId === bay.id && hoveredSlot.row === row && hoveredSlot.tier === tier;
        const highlighted = conflict?.id === highlightedConflictId;

        context.fillStyle = selected ? '#dceef8' : hovered ? '#edf7fb' : '#f3f7fa';
        context.strokeStyle = selected ? '#1676a7' : '#ccd7e1';
        context.lineWidth = selected ? 2 : 1;
        context.beginPath();
        context.roundRect(x, y, CELL_WIDTH, CELL_HEIGHT, 3);
        context.fill();
        context.stroke();

        if (container) {
          const color = container.hazardClass !== 'none'
            ? '#b42318'
            : portMap.get(container.portCode)?.color ?? '#2563eb';
          context.fillStyle = color;
          context.globalAlpha = 0.92;
          context.beginPath();
          context.roundRect(x + 2, y + 2, CELL_WIDTH - 4, CELL_HEIGHT - 4, 2);
          context.fill();
          context.globalAlpha = 1;
          context.save();
          context.translate(x + CELL_WIDTH / 2 + 3, y + CELL_HEIGHT / 2);
          context.rotate(-Math.PI / 2);
          context.fillStyle = '#fff';
          context.font = '700 7px sans-serif';
          context.textAlign = 'center';
          context.fillText(container.number.slice(-5), 0, 2);
          context.restore();
        }

        if (conflict) {
          context.strokeStyle = conflict.severity === 'danger' ? '#d92d3f' : '#d97706';
          context.lineWidth = highlighted ? 3 : 2;
          context.beginPath();
          context.roundRect(x - 2, y - 2, CELL_WIDTH + 4, CELL_HEIGHT + 4, 4);
          context.stroke();
          context.fillStyle = conflict.severity === 'danger' ? '#d92d3f' : '#d97706';
          context.beginPath();
          context.arc(x + CELL_WIDTH - 1, y + 2, 3, 0, Math.PI * 2);
          context.fill();
        }
      }
    }
  }

  function hitSlot(event: React.MouseEvent<HTMLCanvasElement>): Slot | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    for (let bayIndex = 0; bayIndex < bays.length; bayIndex += 1) {
      const bay = bays[bayIndex];
      const panelX = LEFT + bayIndex * (PANEL_WIDTH + GAP);
      for (let row = 1; row <= bay.rows; row += 1) {
        for (let tier = 1; tier <= bay.tiers; tier += 1) {
          const cellX = panelX + 12 + (row - 1) * ROW_WIDTH;
          const cellY = TOP + (bay.tiers - tier) * TIER_HEIGHT;
          if (x >= cellX && x <= cellX + CELL_WIDTH && y >= cellY && y <= cellY + CELL_HEIGHT) {
            return { bayId: bay.id, row, tier };
          }
        }
      }
    }
    return null;
  }

  function handleClick(event: React.MouseEvent<HTMLCanvasElement>) {
    const slot = hitSlot(event);
    if (!slot) return;
    onSlotSelected(slot);
    const placement = placementMap.get(slotKey(slot));
    if (placement) {
      onPlacementSelected(placement);
      if (selectedContainerId && selectedContainerId !== placement.containerId) {
        onSlotAssigned(selectedContainerId, slot);
      }
      return;
    }
    if (selectedContainerId) {
      onSlotAssigned(selectedContainerId, slot);
    }
  }

  function handleContextMenu(event: React.MouseEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const slot = hitSlot(event);
    if (!slot) return;
    const placement = placementMap.get(slotKey(slot));
    if (placement) onPlacementRemoved(placement.id);
  }

  function handleMouseMove(event: React.MouseEvent<HTMLCanvasElement>) {
    const next = hitSlot(event);
    if (slotKey(next) !== slotKey(hoveredSlot)) setHoveredSlot(next);
  }

  function handleDrop(event: React.DragEvent<HTMLCanvasElement>) {
    event.preventDefault();
    setDragOver(false);
    const containerId = event.dataTransfer.getData('application/x-container-id');
    const slot = hitSlot(event);
    if (containerId && slot) onSlotAssigned(containerId, slot);
  }

  const hoveredPlacement = hoveredSlot ? placementMap.get(slotKey(hoveredSlot)) : undefined;
  const hoveredContainer = hoveredPlacement ? containerMap.get(hoveredPlacement.containerId) : undefined;
  const hoveredPort = hoveredContainer ? portMap.get(hoveredContainer.portCode) : undefined;

  return (
    <div className="bay-canvas-shell">
      <div className="bay-canvas-scroll">
        <canvas
          ref={canvasRef}
          style={{ width: canvasWidth, height: canvasHeight }}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredSlot(null)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          aria-label="船舶贝位配载图"
        />
      </div>
      <div className="bay-hover-info">
        {hoveredSlot ? (
          <>
            <strong>贝位 {hoveredSlot.bayId} / {String(hoveredSlot.row).padStart(2, '0')} 排 / {hoveredSlot.tier} 层</strong>
            {hoveredContainer ? (
              <span>
                {hoveredContainer.number} · {hoveredContainer.grossWeight.toFixed(2)} t · {hoveredPort?.name} · {hoveredContainer.type}
              </span>
            ) : (
              <span>空格位 · 可接收集装箱</span>
            )}
          </>
        ) : (
          <span>移入格位查看箱号、重量和目的港；右键可移除箱。</span>
        )}
      </div>
    </div>
  );
});

function slotKey(slot: Slot | null | undefined): string {
  return slot ? `${slot.bayId}:${slot.row}:${slot.tier}` : '';
}
