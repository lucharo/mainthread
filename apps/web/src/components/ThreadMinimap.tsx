import { useCallback, useMemo, useState } from 'react';
import type { Thread } from '../store/threadStore';

interface ThreadMinimapProps {
  threads: Thread[];
  activeThreadId: string | null;
  onNavigate: (threadId: string) => void;
}

interface TreeNode {
  thread: Thread;
  children: TreeNode[];
  depth: number;
}

// Layout constants
const NODE_W = 100;
const NODE_H = 28;
const H_GAP = 16;
const V_GAP = 20;

function buildTree(threads: Thread[]): TreeNode[] {
  const nonArchived = threads.filter((t) => !t.archivedAt);
  const childrenMap = new Map<string | null, Thread[]>();

  for (const t of nonArchived) {
    const parentKey = t.parentId ?? null;
    if (!childrenMap.has(parentKey)) childrenMap.set(parentKey, []);
    childrenMap.get(parentKey)!.push(t);
  }

  function build(parentId: string | null, depth: number): TreeNode[] {
    const kids = childrenMap.get(parentId) || [];
    return kids.map((thread) => ({
      thread,
      children: build(thread.id, depth + 1),
      depth,
    }));
  }

  return build(null, 0);
}

// Compute positions using a simple recursive layout
interface PositionedNode {
  thread: Thread;
  x: number;
  y: number;
  children: PositionedNode[];
}

function layoutTree(
  nodes: TreeNode[],
  startX: number,
  startY: number
): { positioned: PositionedNode[]; totalWidth: number; totalHeight: number } {
  let maxWidth = 0;
  let maxHeight = 0;

  function layout(node: TreeNode, x: number, y: number): { positioned: PositionedNode; width: number } {
    if (node.children.length === 0) {
      const h = y + NODE_H;
      if (h > maxHeight) maxHeight = h;
      const w = NODE_W;
      if (x + w > maxWidth) maxWidth = x + w;
      return { positioned: { thread: node.thread, x, y, children: [] }, width: NODE_W };
    }

    let childX = x;
    const childY = y + NODE_H + V_GAP;
    const positionedChildren: PositionedNode[] = [];
    let totalChildWidth = 0;

    for (let i = 0; i < node.children.length; i++) {
      const result = layout(node.children[i], childX, childY);
      positionedChildren.push(result.positioned);
      totalChildWidth += result.width;
      childX += result.width + H_GAP;
    }
    // Remove last gap
    totalChildWidth += (node.children.length - 1) * H_GAP;

    const nodeWidth = Math.max(NODE_W, totalChildWidth);
    // Center the parent over children
    const nodeX = positionedChildren.length > 0
      ? positionedChildren[0].x + (positionedChildren[positionedChildren.length - 1].x + NODE_W - positionedChildren[0].x) / 2 - NODE_W / 2
      : x;

    const endX = nodeX + NODE_W;
    if (endX > maxWidth) maxWidth = endX;
    const endY = y + NODE_H;
    if (endY > maxHeight) maxHeight = endY;

    return {
      positioned: { thread: node.thread, x: nodeX, y, children: positionedChildren },
      width: nodeWidth,
    };
  }

  let currentX = startX;
  const roots: PositionedNode[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const result = layout(nodes[i], currentX, startY);
    roots.push(result.positioned);
    currentX += result.width + H_GAP;
  }

  return { positioned: roots, totalWidth: maxWidth, totalHeight: maxHeight };
}

const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e',
  pending: '#f59e0b',
  done: '#9ca3af',
  needs_attention: '#ef4444',
  new_message: '#3b82f6',
};

function getStatusColor(status: string): string {
  return STATUS_COLORS[status] || '#9ca3af';
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '\u2026' : text;
}

function NodeRenderer({
  node,
  activeThreadId,
  collapsedIds,
  onNavigate,
  onToggleCollapse,
}: {
  node: PositionedNode;
  activeThreadId: string | null;
  collapsedIds: Set<string>;
  onNavigate: (id: string) => void;
  onToggleCollapse: (id: string) => void;
}) {
  const isActive = node.thread.id === activeThreadId;
  const isCollapsed = collapsedIds.has(node.thread.id);
  const color = getStatusColor(node.thread.status);
  const hasChildren = node.children.length > 0;

  return (
    <>
      {/* Lines from this node to children */}
      {!isCollapsed &&
        node.children.map((child) => (
          <line
            key={`edge-${node.thread.id}-${child.thread.id}`}
            x1={node.x + NODE_W / 2}
            y1={node.y + NODE_H}
            x2={child.x + NODE_W / 2}
            y2={child.y}
            stroke="#525252"
            strokeWidth={1}
            strokeDasharray={child.thread.status === 'done' ? '4,2' : undefined}
          />
        ))}

      {/* Node rectangle */}
      <g
        className="cursor-pointer"
        onClick={() => onNavigate(node.thread.id)}
        role="button"
        tabIndex={0}
        aria-label={`Navigate to thread: ${node.thread.title}`}
      >
        <rect
          x={node.x}
          y={node.y}
          width={NODE_W}
          height={NODE_H}
          rx={6}
          ry={6}
          fill={color + '22'}
          stroke={isActive ? '#f97316' : color}
          strokeWidth={isActive ? 2 : 1}
        />
        {isActive && (
          <rect
            x={node.x - 2}
            y={node.y - 2}
            width={NODE_W + 4}
            height={NODE_H + 4}
            rx={8}
            ry={8}
            fill="none"
            stroke="#f97316"
            strokeWidth={1}
            strokeDasharray="4,2"
            opacity={0.5}
          />
        )}
        <text
          x={node.x + NODE_W / 2}
          y={node.y + NODE_H / 2 + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={10}
          fill="currentColor"
          className="select-none pointer-events-none"
        >
          {truncate(node.thread.title, 12)}
        </text>
      </g>

      {/* Collapse/expand indicator */}
      {hasChildren && (
        <g
          className="cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse(node.thread.id);
          }}
          role="button"
          tabIndex={0}
          aria-label={isCollapsed ? 'Expand branch' : 'Collapse branch'}
        >
          <circle
            cx={node.x + NODE_W / 2}
            cy={node.y + NODE_H + 6}
            r={6}
            fill="var(--background, #1a1a1a)"
            stroke="#525252"
            strokeWidth={1}
          />
          <text
            x={node.x + NODE_W / 2}
            y={node.y + NODE_H + 7}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={10}
            fill="#9ca3af"
            className="select-none pointer-events-none"
          >
            {isCollapsed ? '+' : '\u2212'}
          </text>
        </g>
      )}

      {/* Recursively render children */}
      {!isCollapsed &&
        node.children.map((child) => (
          <NodeRenderer
            key={child.thread.id}
            node={child}
            activeThreadId={activeThreadId}
            collapsedIds={collapsedIds}
            onNavigate={onNavigate}
            onToggleCollapse={onToggleCollapse}
          />
        ))}
    </>
  );
}

export function ThreadMinimap({ threads, activeThreadId, onNavigate }: ThreadMinimapProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const handleToggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const tree = useMemo(() => buildTree(threads), [threads]);
  const { positioned, totalWidth, totalHeight } = useMemo(
    () => layoutTree(tree, 8, 8),
    [tree]
  );

  if (positioned.length === 0) {
    return (
      <div className="text-xs text-muted-foreground p-2 text-center">No threads</div>
    );
  }

  const svgWidth = totalWidth + 16;
  const svgHeight = totalHeight + 24; // Extra space for collapse indicators

  return (
    <div className="overflow-auto max-h-64 p-1">
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="text-foreground"
      >
        {positioned.map((node) => (
          <NodeRenderer
            key={node.thread.id}
            node={node}
            activeThreadId={activeThreadId}
            collapsedIds={collapsedIds}
            onNavigate={onNavigate}
            onToggleCollapse={handleToggleCollapse}
          />
        ))}
      </svg>
    </div>
  );
}
