import { useCallback, useMemo, useState, useRef } from 'react';
import type { Thread } from '../store/threadStore';

interface ThreadMinimapProps {
  threads: Thread[];
  activeThreadId: string | null;
  onNavigate: (threadId: string) => void;
}

interface TreeNode {
  thread: Thread;
  children: TreeNode[];
}

const DOT_RADIUS = 5;
const ACTIVE_RADIUS = 7;
const H_SPACING = 28;
const V_SPACING = 24;
const PADDING = 16;

const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e',
  pending: '#f59e0b',
  running: '#3b82f6',
  done: '#9ca3af',
  needs_attention: '#f59e0b',
  new_message: '#3b82f6',
};

function getColor(status: string): string {
  return STATUS_COLORS[status] || '#9ca3af';
}

function buildTree(threads: Thread[]): TreeNode[] {
  const visible = threads.filter((t) => !t.archivedAt);
  const byParent = new Map<string | null, Thread[]>();
  for (const t of visible) {
    const key = t.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(t);
  }
  function build(parentId: string | null): TreeNode[] {
    return (byParent.get(parentId) || []).map((t) => ({
      thread: t,
      children: build(t.id),
    }));
  }
  return build(null);
}

interface Positioned {
  id: string;
  thread: Thread;
  x: number;
  y: number;
  children: Positioned[];
}

function layoutTree(roots: TreeNode[]): { nodes: Positioned[]; w: number; h: number } {
  let nextLeafX = 0;

  function lay(node: TreeNode, depth: number): Positioned {
    const y = depth * V_SPACING;
    if (node.children.length === 0) {
      const x = nextLeafX;
      nextLeafX += H_SPACING;
      return { id: node.thread.id, thread: node.thread, x, y, children: [] };
    }
    const kids = node.children.map((c) => lay(c, depth + 1));
    const x = (kids[0].x + kids[kids.length - 1].x) / 2;
    return { id: node.thread.id, thread: node.thread, x, y, children: kids };
  }

  const positioned = roots.map((r) => lay(r, 0));
  const allNodes: Positioned[] = [];
  function collect(n: Positioned) {
    allNodes.push(n);
    n.children.forEach(collect);
  }
  positioned.forEach(collect);

  const maxX = allNodes.reduce((m, n) => Math.max(m, n.x), 0);
  const maxY = allNodes.reduce((m, n) => Math.max(m, n.y), 0);

  return {
    nodes: positioned,
    w: maxX + PADDING * 2,
    h: maxY + PADDING * 2,
  };
}

function DotNode({
  node,
  activeThreadId,
  onNavigate,
  tooltip,
  setTooltip,
}: {
  node: Positioned;
  activeThreadId: string | null;
  onNavigate: (id: string) => void;
  tooltip: string | null;
  setTooltip: (id: string | null) => void;
}) {
  const isActive = node.id === activeThreadId;
  const color = getColor(node.thread.status);
  const r = isActive ? ACTIVE_RADIUS : DOT_RADIUS;

  return (
    <>
      {/* Lines to children */}
      {node.children.map((child) => (
        <line
          key={`e-${node.id}-${child.id}`}
          x1={node.x + PADDING}
          y1={node.y + PADDING}
          x2={child.x + PADDING}
          y2={child.y + PADDING}
          stroke="#525252"
          strokeWidth={1.5}
          strokeDasharray={child.thread.status === 'done' ? '3,2' : undefined}
        />
      ))}

      {/* Active glow */}
      {isActive && (
        <circle
          cx={node.x + PADDING}
          cy={node.y + PADDING}
          r={r + 4}
          fill="none"
          stroke="#f97316"
          strokeWidth={1.5}
          opacity={0.4}
        />
      )}

      {/* Invisible larger hit area for easier clicking */}
      <circle
        cx={node.x + PADDING}
        cy={node.y + PADDING}
        r={12}
        fill="transparent"
        className="cursor-pointer"
        onClick={() => onNavigate(node.id)}
        onMouseEnter={() => setTooltip(node.id)}
        onMouseLeave={() => setTooltip(null)}
      />

      {/* Dot */}
      <circle
        cx={node.x + PADDING}
        cy={node.y + PADDING}
        r={r}
        fill={color}
        stroke={isActive ? '#f97316' : 'none'}
        strokeWidth={isActive ? 2 : 0}
        className="cursor-pointer transition-transform pointer-events-none"
        onClick={() => onNavigate(node.id)}
        onMouseEnter={() => setTooltip(node.id)}
        onMouseLeave={() => setTooltip(null)}
      />

      {/* Tooltip - show below dot if near top, above otherwise */}
      {tooltip === node.id && (() => {
        const showBelow = node.y < V_SPACING;
        const ty = showBelow
          ? node.y + PADDING + r + 14
          : node.y + PADDING - r - 10;
        const ry = showBelow
          ? node.y + PADDING + r + 5
          : node.y + PADDING - r - 22;
        const label = node.thread.title.length > 18
          ? node.thread.title.slice(0, 17) + '\u2026'
          : node.thread.title;
        const boxW = Math.max(label.length * 6.5 + 12, 50);
        return (
          <g>
            <rect
              x={node.x + PADDING - boxW / 2}
              y={ry}
              width={boxW}
              height={18}
              rx={4}
              fill="rgba(0,0,0,0.85)"
            />
            <text
              x={node.x + PADDING}
              y={ty}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={10}
              fill="#fff"
              className="select-none pointer-events-none"
            >
              {label}
            </text>
          </g>
        );
      })()}

      {/* Children */}
      {node.children.map((child) => (
        <DotNode
          key={child.id}
          node={child}
          activeThreadId={activeThreadId}
          onNavigate={onNavigate}
          tooltip={tooltip}
          setTooltip={setTooltip}
        />
      ))}
    </>
  );
}

export function ThreadMinimap({ threads, activeThreadId, onNavigate }: ThreadMinimapProps) {
  const [tooltip, setTooltip] = useState<string | null>(null);

  const tree = useMemo(() => buildTree(threads), [threads]);
  const { nodes, w, h } = useMemo(() => layoutTree(tree), [tree]);

  if (nodes.length === 0) return null;

  const svgW = Math.max(w, 60);
  const svgH = Math.max(h, 40);

  return (
    <div
      className="fixed bottom-4 right-4 z-20 bg-background/90 backdrop-blur-sm border border-border rounded-lg shadow-lg"
      style={{ maxWidth: 260, maxHeight: 200, overflow: 'visible' }}
    >
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="text-foreground"
        style={{ overflow: 'visible' }}
      >
        {nodes.map((node) => (
          <DotNode
            key={node.id}
            node={node}
            activeThreadId={activeThreadId}
            onNavigate={onNavigate}
            tooltip={tooltip}
            setTooltip={setTooltip}
          />
        ))}
      </svg>
    </div>
  );
}
