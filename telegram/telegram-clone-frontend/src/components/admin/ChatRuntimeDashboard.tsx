import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Cpu,
  Database,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Timer,
  Workflow,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { authUtils } from '../../services/apiClient';
import { opsAPI, type ChatRuntimeOpsSnapshot } from '../../services/opsApi';
import chatCoreClient from '../../core/bridge/chatCoreClient';
import { resolveChatRuntimePolicy } from '../../core/chat/rolloutPolicy';
import type { ChatCoreRuntimeInfo } from '../../core/chat/types';
import './ChatRuntimeDashboard.css';

function num(n: number | null | undefined): string {
  if (!Number.isFinite(Number(n))) return '-';
  const value = Number(n);
  if (Math.abs(value) >= 1000) return value.toLocaleString();
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function fmtTime(value?: string | number): string {
  if (value === undefined || value === null) return '-';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function pickCounter(snapshot: ChatRuntimeOpsSnapshot | null, key: string): number {
  if (!snapshot) return 0;
  return Number(snapshot.counters[key] || 0);
}

function sumCounters(snapshot: ChatRuntimeOpsSnapshot | null, prefix: string, suffix: string): number {
  if (!snapshot) return 0;
  let sum = 0;
  for (const [key, value] of Object.entries(snapshot.counters || {})) {
    if (!key.startsWith(prefix)) continue;
    if (suffix && !key.endsWith(suffix)) continue;
    sum += Number(value || 0);
  }
  return sum;
}

function buildTrailSeries(snapshot: ChatRuntimeOpsSnapshot | null): Array<{
  slot: string;
  count: number;
  p95: number;
  avg: number;
}> {
  if (!snapshot || !Array.isArray(snapshot.requestTrail)) return [];
  const bucket = new Map<string, number[]>();
  for (const item of snapshot.requestTrail) {
    const date = new Date(item.at);
    if (Number.isNaN(date.getTime())) continue;
    const slot = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const list = bucket.get(slot);
    if (list) {
      list.push(Number(item.durationMs || 0));
    } else {
      bucket.set(slot, [Number(item.durationMs || 0)]);
    }
  }

  const out = Array.from(bucket.entries()).map(([slot, values]) => {
    const sorted = values.slice().sort((a, b) => a - b);
    const p95 = sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.95)))] || 0;
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    return {
      slot,
      count: values.length,
      p95,
      avg,
    };
  });

  out.sort((a, b) => a.slot.localeCompare(b.slot));
  return out.slice(-24);
}

const ChatRuntimeDashboard: React.FC = () => {
  const [snapshot, setSnapshot] = useState<ChatRuntimeOpsSnapshot | null>(null);
  const [runtimeInfo, setRuntimeInfo] = useState<ChatCoreRuntimeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [resetting, setResetting] = useState(false);

  const userId = authUtils.getCurrentUser()?.id || '';
  const rolloutPolicy = useMemo(
    () => (userId ? resolveChatRuntimePolicy(userId) : null),
    [userId],
  );

  const fetchAll = useCallback(async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const [ops, runtime] = await Promise.all([
        opsAPI.getChatRuntimeSnapshot(),
        chatCoreClient.getRuntimeInfo().catch(() => null),
      ]);
      setSnapshot(ops);
      if (runtime) setRuntimeInfo(runtime);
    } catch (err: any) {
      setError(err?.message || '加载运行时指标失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handleReset = useCallback(async () => {
    if (resetting) return;
    if (!window.confirm('确认重置当前 Chat Runtime 指标快照？')) return;
    setResetting(true);
    setError(null);
    try {
      await opsAPI.resetChatRuntimeSnapshot();
      await fetchAll(false);
    } catch (err: any) {
      setError(err?.message || '重置指标失败');
    } finally {
      setResetting(false);
    }
  }, [fetchAll, resetting]);

  useEffect(() => {
    void fetchAll(false);
    const t = window.setInterval(() => {
      void fetchAll(true);
    }, 15_000);
    return () => window.clearInterval(t);
  }, [fetchAll]);

  const trendSeries = useMemo(() => buildTrailSeries(snapshot), [snapshot]);
  const routeDurations = useMemo(() => {
    if (!snapshot) return [];
    return Object.entries(snapshot.durations || {})
      .filter(([key]) => key.startsWith('http.latency.route.'))
      .map(([key, value]) => ({
        route: key.replace('http.latency.route.', ''),
        p95: value.p95Ms,
        avg: value.avgMs,
        count: value.count,
      }))
      .sort((a, b) => b.p95 - a.p95)
      .slice(0, 10);
  }, [snapshot]);

  if (loading && !snapshot) {
    return (
      <div className="chat-runtime-dashboard">
        <div className="chat-runtime-loading">
          <RefreshCw size={18} className="spin" />
          <span>加载 Chat Runtime 指标...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-runtime-dashboard">
      <header className="chat-runtime-header">
        <div className="chat-runtime-title">
          <Activity size={22} />
          <div>
            <h1>Chat Runtime Ops</h1>
            <p>Worker-first 指标与灰度策略观测面板</p>
          </div>
        </div>
        <div className="chat-runtime-actions">
          <Link to="/admin/dashboard" className="chat-runtime-link">返回推荐看板</Link>
          <button
            type="button"
            className="chat-runtime-reset"
            onClick={() => void handleReset()}
            disabled={resetting}
          >
            {resetting ? '重置中...' : '重置快照'}
          </button>
          <button
            type="button"
            className="chat-runtime-refresh"
            onClick={() => void fetchAll(true)}
            disabled={refreshing}
          >
            <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
            刷新
          </button>
        </div>
      </header>

      {error ? <div className="chat-runtime-error">{error}</div> : null}

      <section className="chat-runtime-kpis">
        <article className="chat-runtime-kpi">
          <div className="kpi-label"><Database size={14} /> HTTP 请求总数</div>
          <div className="kpi-value">{num(pickCounter(snapshot, 'http.requests.total'))}</div>
        </article>
        <article className="chat-runtime-kpi">
          <div className="kpi-label"><Workflow size={14} /> Sync 请求总数</div>
          <div className="kpi-value">{num(sumCounters(snapshot, 'sync.', '.requests'))}</div>
        </article>
        <article className="chat-runtime-kpi">
          <div className="kpi-label"><Gauge size={14} /> Socket 发送成功</div>
          <div className="kpi-value">{num(pickCounter(snapshot, 'socket.sendMessage.success'))}</div>
        </article>
        <article className="chat-runtime-kpi">
          <div className="kpi-label"><Cpu size={14} /> Worker GapRecover</div>
          <div className="kpi-value">{num(runtimeInfo?.telemetry.gapRecoverRuns || 0)}</div>
        </article>
      </section>

      <section className="chat-runtime-grid">
        <article className="chat-runtime-card">
          <h3><Timer size={16} /> 请求时延趋势（最近 24 个时间槽）</h3>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trendSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="slot" stroke="rgba(255,255,255,0.5)" />
                <YAxis stroke="rgba(255,255,255,0.5)" />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(12, 18, 32, 0.95)',
                    border: '1px solid rgba(127, 151, 191, 0.35)',
                    borderRadius: 10,
                  }}
                />
                <Line type="monotone" dataKey="p95" stroke="#f9b233" strokeWidth={2} dot={false} name="P95(ms)" />
                <Line type="monotone" dataKey="avg" stroke="#3db2ff" strokeWidth={2} dot={false} name="AVG(ms)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="chat-runtime-card">
          <h3><ShieldCheck size={16} /> 灰度策略（当前用户）</h3>
          <div className="policy-grid">
            <div><span>用户 ID</span><strong>{userId || '-'}</strong></div>
            <div><span>策略 Profile</span><strong>{rolloutPolicy?.profile || '-'}</strong></div>
            <div><span>Profile Source</span><strong>{rolloutPolicy?.profileSource || '-'}</strong></div>
            <div><span>Profile Locked</span><strong>{rolloutPolicy?.profileLocked ? 'true' : 'false'}</strong></div>
            <div><span>Matrix Version</span><strong>{rolloutPolicy?.matrixVersion || '-'}</strong></div>
            <div><span>Emergency Safe</span><strong>{rolloutPolicy?.emergencySafeMode ? 'true' : 'false'}</strong></div>
            <div><span>Socket Rollout</span><strong>{num(rolloutPolicy?.rollout.socketPercent)}%</strong></div>
            <div><span>Safety Rollout</span><strong>{num(rolloutPolicy?.rollout.safetyChecksPercent)}%</strong></div>
            <div><span>Media Rollout</span><strong>{num(rolloutPolicy?.rollout.mediaPoolPercent)}%</strong></div>
          </div>
          <div className="flag-grid">
            <span>workerSocket: {String(rolloutPolicy?.enableWorkerSocket)}</span>
            <span>syncFallback: {String(rolloutPolicy?.enableWorkerSyncFallback)}</span>
            <span>safetyChecks: {String(rolloutPolicy?.enableWorkerSafetyChecks)}</span>
            <span>searchIndex: {String(rolloutPolicy?.enableSearchTieredIndex)}</span>
            <span>searchWasm: {String(rolloutPolicy?.enableSearchTieredWasm)}</span>
            <span>mediaPool: {String(rolloutPolicy?.enableMediaWorkerPool)}</span>
          </div>
        </article>

        <article className="chat-runtime-card chat-runtime-card--full">
          <h3><Activity size={16} /> 路由时延 Top10（P95）</h3>
          <div className="route-table">
            <div className="row head">
              <span>Route</span>
              <span>P95</span>
              <span>AVG</span>
              <span>Count</span>
            </div>
            {routeDurations.length === 0 ? (
              <div className="row"><span>暂无数据</span><span>-</span><span>-</span><span>-</span></div>
            ) : (
              routeDurations.map((item) => (
                <div key={item.route} className="row">
                  <span className="route-name">{item.route}</span>
                  <span>{num(item.p95)}ms</span>
                  <span>{num(item.avg)}ms</span>
                  <span>{num(item.count)}</span>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="chat-runtime-card">
          <h3><Cpu size={16} /> Worker Runtime</h3>
          <div className="policy-grid">
            <div><span>Protocol</span><strong>{runtimeInfo?.protocolVersion ?? '-'}</strong></div>
            <div><span>Build</span><strong>{runtimeInfo?.workerBuildId || '-'}</strong></div>
            <div><span>Runtime Profile</span><strong>{runtimeInfo?.runtimePolicy.profile || '-'}</strong></div>
            <div><span>Policy Source</span><strong>{runtimeInfo?.runtimePolicy.profileSource || '-'}</strong></div>
            <div><span>Memory Window</span><strong>{num(runtimeInfo?.flags.chatMemoryWindow)}</strong></div>
            <div><span>Patch Queue Peak</span><strong>{num(runtimeInfo?.telemetry.patchQueuePeak)}</strong></div>
            <div><span>Patch Dispatch</span><strong>{num(runtimeInfo?.telemetry.patchDispatchCount)}</strong></div>
            <div><span>Patch Drop (Backpressure)</span><strong>{num(runtimeInfo?.telemetry.patchDroppedByBackpressure)}</strong></div>
            <div><span>Trim Runs</span><strong>{num(runtimeInfo?.telemetry.trimRuns)}</strong></div>
            <div><span>Trim Removed IDs</span><strong>{num(runtimeInfo?.telemetry.trimRemovedIds)}</strong></div>
            <div><span>Trim Oldest Runs</span><strong>{num(runtimeInfo?.telemetry.trimOldestRuns)}</strong></div>
            <div><span>Trim Newest Runs</span><strong>{num(runtimeInfo?.telemetry.trimNewestRuns)}</strong></div>
            <div><span>Fetch Count</span><strong>{num(runtimeInfo?.telemetry.fetchCount)}</strong></div>
            <div><span>Fetch Errors</span><strong>{num(runtimeInfo?.telemetry.fetchErrorCount)}</strong></div>
            <div><span>Sync Loop Starts</span><strong>{num(runtimeInfo?.telemetry.syncLoopStarts)}</strong></div>
            <div><span>Sync Backoff Retries</span><strong>{num(runtimeInfo?.telemetry.syncBackoffRetries)}</strong></div>
            <div><span>Socket Connects</span><strong>{num(runtimeInfo?.telemetry.socketConnects)}</strong></div>
            <div><span>Socket Errors</span><strong>{num(runtimeInfo?.telemetry.socketConnectErrors)}</strong></div>
            <div><span>Gap Skip (InFlight)</span><strong>{num(runtimeInfo?.telemetry.gapRecoverSkippedInFlight)}</strong></div>
            <div><span>Gap Skip (Cooldown)</span><strong>{num(runtimeInfo?.telemetry.gapRecoverSkippedCooldown)}</strong></div>
            <div><span>Gap Skip (Socket)</span><strong>{num(runtimeInfo?.telemetry.gapRecoverSkippedSocketConnected)}</strong></div>
            <div><span>Gap Skip (Budget)</span><strong>{num(runtimeInfo?.telemetry.gapRecoverSkippedBudget)}</strong></div>
            <div><span>Gap Skip (Flapping)</span><strong>{num(runtimeInfo?.telemetry.gapRecoverSkippedFlapping)}</strong></div>
            <div><span>Reconnect Recover Runs</span><strong>{num(runtimeInfo?.telemetry.reconnectGapRecoverRuns)}</strong></div>
            <div><span>Reconnect Skip (Short)</span><strong>{num(runtimeInfo?.telemetry.reconnectGapRecoverSkippedShortDisconnect)}</strong></div>
            <div><span>Reconnect Skip (Interval)</span><strong>{num(runtimeInfo?.telemetry.reconnectGapRecoverSkippedMinInterval)}</strong></div>
            <div><span>Connectivity Transitions</span><strong>{num(runtimeInfo?.telemetry.connectivityTransitions)}</strong></div>
            <div><span>Connectivity Flap Events</span><strong>{num(runtimeInfo?.telemetry.connectivityFlapEvents)}</strong></div>
            <div><span>Sync Drop (Stale)</span><strong>{num(runtimeInfo?.telemetry.syncUpdatesDroppedStale)}</strong></div>
            <div><span>Sync Drop (Duplicate)</span><strong>{num(runtimeInfo?.telemetry.syncUpdatesDroppedDuplicate)}</strong></div>
            <div><span>Sync Drop (Invalid)</span><strong>{num(runtimeInfo?.telemetry.syncUpdatesDroppedInvalid)}</strong></div>
            <div><span>Sync Gap Events</span><strong>{num(runtimeInfo?.telemetry.syncUpdateGapEvents)}</strong></div>
            <div><span>Sync Gap Max</span><strong>{num(runtimeInfo?.telemetry.syncUpdateGapMax)}</strong></div>
            <div><span>Sync PTS Regressions Blocked</span><strong>{num(runtimeInfo?.telemetry.syncPtsRegressionBlocked)}</strong></div>
            <div><span>Sync Contract Mismatch</span><strong>{num(runtimeInfo?.telemetry.syncContractMismatchCount)}</strong></div>
            <div><span>WASM Shadow Runs</span><strong>{num(runtimeInfo?.telemetry.wasmShadowCompareRuns)}</strong></div>
            <div><span>WASM Shadow Mismatch</span><strong>{num(runtimeInfo?.telemetry.wasmShadowCompareMismatches)}</strong></div>
            <div><span>WASM Shadow Fallback</span><strong>{num(runtimeInfo?.telemetry.wasmShadowCompareFallbacks)}</strong></div>
            <div><span>WASM Version</span><strong>{runtimeInfo?.wasm.version || '-'}</strong></div>
            <div><span>WASM Shadow Compare</span><strong>{String(runtimeInfo?.flags.wasmShadowCompare)}</strong></div>
            <div><span>WASM Shadow Sample</span><strong>{num(runtimeInfo?.flags.wasmShadowCompareSampleRate)}%</strong></div>
          </div>
        </article>

        <article className="chat-runtime-card">
          <h3><Gauge size={16} /> Snapshot Meta</h3>
          <div className="policy-grid">
            <div><span>Started At</span><strong>{fmtTime(snapshot?.startedAt)}</strong></div>
            <div><span>Updated At</span><strong>{fmtTime(snapshot?.updatedAt)}</strong></div>
            <div><span>Trail Size</span><strong>{num(snapshot?.requestTrail?.length || 0)}</strong></div>
            <div><span>Gauge Keys</span><strong>{num(Object.keys(snapshot?.gauges || {}).length)}</strong></div>
            <div><span>Counter Keys</span><strong>{num(Object.keys(snapshot?.counters || {}).length)}</strong></div>
            <div><span>Duration Keys</span><strong>{num(Object.keys(snapshot?.durations || {}).length)}</strong></div>
            <div><span>Sync Contract Error</span><strong>{runtimeInfo?.sync.contractError || '-'}</strong></div>
            <div><span>Sync Validated</span><strong>{fmtTime(runtimeInfo?.sync.contractValidatedAt)}</strong></div>
            <div><span>Sync Backoff Until</span><strong>{fmtTime(runtimeInfo?.sync.contractBackoffUntil)}</strong></div>
            <div><span>Runtime Policy Matrix</span><strong>{runtimeInfo?.runtimePolicy.matrixVersion || '-'}</strong></div>
            <div><span>Environment API</span><strong>{String(import.meta.env.VITE_API_BASE_URL || '-')}</strong></div>
            <div><span>Environment Socket</span><strong>{String(import.meta.env.VITE_SOCKET_URL || '-')}</strong></div>
          </div>
        </article>
      </section>
    </div>
  );
};

export default ChatRuntimeDashboard;
