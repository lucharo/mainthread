import { useEffect, useState } from 'react';

interface CacheStats {
  cached_clients: number;
  max_cached: number;
  ttl_seconds: number;
  hits: number;
  misses: number;
  hit_rate: number;
}

interface Stats {
  cpu_percent: number;
  memory_percent: number;
  memory_used_gb: number;
  memory_total_gb: number;
  claude_process_count: number;
  cache: CacheStats;
  error?: string;
}

function StatBar({
  value,
  max = 100,
  colorThresholds = { warning: 50, critical: 80 },
}: {
  value: number;
  max?: number;
  colorThresholds?: { warning: number; critical: number };
}) {
  const percent = Math.min((value / max) * 100, 100);
  const color =
    value > colorThresholds.critical
      ? 'bg-red-500'
      : value > colorThresholds.warning
        ? 'bg-yellow-500'
        : 'bg-green-500';

  return (
    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
      <div
        className={`h-full ${color} transition-all duration-300`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export function SystemStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats');
        if (res.ok) {
          setStats(await res.json());
          setError(null);
        } else {
          setError('Failed to fetch stats');
        }
      } catch {
        setError('Stats unavailable');
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000); // Every 5 seconds
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div className="text-xs text-muted-foreground px-3 py-2 border-t border-border">
        {error}
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-xs text-muted-foreground px-3 py-2 border-t border-border animate-pulse">
        Loading stats...
      </div>
    );
  }

  return (
    <div className="border-t border-border">
      {/* Compact view - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span
            className={
              stats.cpu_percent > 80
                ? 'text-red-500'
                : stats.cpu_percent > 50
                  ? 'text-yellow-500'
                  : 'text-green-500'
            }
          >
            CPU {stats.cpu_percent.toFixed(0)}%
          </span>
          <span
            className={
              stats.memory_percent > 80
                ? 'text-red-500'
                : stats.memory_percent > 50
                  ? 'text-yellow-500'
                  : 'text-green-500'
            }
          >
            RAM {stats.memory_percent.toFixed(0)}%
          </span>
          <span>Claude: {stats.claude_process_count}</span>
        </div>
        <svg
          className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* CPU */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">CPU</span>
              <span>{stats.cpu_percent.toFixed(1)}%</span>
            </div>
            <StatBar value={stats.cpu_percent} />
          </div>

          {/* Memory */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Memory</span>
              <span>
                {stats.memory_used_gb}GB / {stats.memory_total_gb}GB
              </span>
            </div>
            <StatBar value={stats.memory_percent} />
          </div>

          {/* Cache stats */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Client Cache</span>
              <span>
                {stats.cache.cached_clients}/{stats.cache.max_cached}
              </span>
            </div>
            <StatBar
              value={stats.cache.cached_clients}
              max={stats.cache.max_cached}
              colorThresholds={{ warning: 3, critical: 4 }}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Hit rate</span>
              <span>{(stats.cache.hit_rate * 100).toFixed(1)}%</span>
            </div>
          </div>

          {/* Claude processes */}
          {stats.claude_process_count > 0 && (
            <div className="text-xs">
              <div className="text-muted-foreground mb-1">
                Claude Processes ({stats.claude_process_count})
              </div>
              <div className="text-muted-foreground/70">
                Active subprocesses for thread execution
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
