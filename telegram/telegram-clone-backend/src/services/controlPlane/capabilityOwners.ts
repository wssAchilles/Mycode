import type { DeliveryConsumerOpsSnapshot } from '../chatDelivery/deliveryConsumerOps';
import {
  buildRealtimeTransportCatalog,
  isRustRealtimeEdgePrimary,
  readRealtimeRolloutStage,
} from '../realtimeProtocol/contracts';
import type { GraphKernelOpsSnapshot } from '../graphKernel/contracts';
import { getRustRecommendationMode } from '../recommendation/clients/RustRecommendationClient';

export type CapabilityOwnerName = 'realtime' | 'recommendation' | 'platform' | 'graph';
export type CapabilityRuntimeOwner = 'node' | 'rust' | 'go' | 'cpp';

export interface CapabilityOwnerRecord {
  capability: CapabilityOwnerName;
  owner: CapabilityRuntimeOwner;
  nodeRole: string[];
  fallbackEnabled: boolean;
  fallbackMode: string;
  primarySurface: string[];
  controlPlanePath: string;
}

export interface NodeCapabilityOwnershipSummary {
  nodeStrategicShape: {
    owner: 'node';
    responsibilities: string[];
    mode: 'api_control_fallback_plane';
  };
  capabilities: CapabilityOwnerRecord[];
  summary: string;
}

type BuildCapabilityOwnershipInput = {
  consumer?: DeliveryConsumerOpsSnapshot;
  graphKernel?: GraphKernelOpsSnapshot;
};

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null || value.trim() === '') {
    return fallback;
  }
  return !['0', 'false', 'off', 'no'].includes(value.trim().toLowerCase());
}

function readRuntimeString(
  runtime: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
): string {
  const value = runtime?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function buildNodeCapabilityOwnershipSummary(
  input: BuildCapabilityOwnershipInput = {},
): NodeCapabilityOwnershipSummary {
  const realtimeStage = readRealtimeRolloutStage();
  const realtimeCatalog = buildRealtimeTransportCatalog(realtimeStage);
  const rustRealtimePrimary = isRustRealtimeEdgePrimary(realtimeStage);
  const recommendationMode = getRustRecommendationMode();
  const consumerRuntime = (input.consumer?.runtime || {}) as Record<string, unknown>;
  const graphKernelEnabled = readBool(process.env.CPP_GRAPH_KERNEL_ENABLED, true);

  const syncWakeExecutionMode = readRuntimeString(
    consumerRuntime,
    'syncWakeExecutionMode',
    String(process.env.DELIVERY_CONSUMER_SYNC_WAKE_EXECUTION_MODE || 'publish'),
  );
  const presenceExecutionMode = readRuntimeString(
    consumerRuntime,
    'presenceExecutionMode',
    String(process.env.DELIVERY_CONSUMER_PRESENCE_EXECUTION_MODE || 'publish'),
  );
  const notificationExecutionMode = readRuntimeString(
    consumerRuntime,
    'notificationExecutionMode',
    String(process.env.DELIVERY_CONSUMER_NOTIFICATION_EXECUTION_MODE || 'publish'),
  );
  const platformPrimaryModes = [syncWakeExecutionMode, presenceExecutionMode, notificationExecutionMode];
  const goPlatformPrimary = platformPrimaryModes.every((value) => value === 'publish');

  const capabilities: CapabilityOwnerRecord[] = [
    {
      capability: 'realtime',
      owner: rustRealtimePrimary ? 'rust' : 'node',
      nodeRole: rustRealtimePrimary
        ? ['compat_transport_shim', 'event_publisher', 'fallback_emitter']
        : ['primary_transport', 'event_publisher'],
      fallbackEnabled: true,
      fallbackMode: `preferred=${realtimeCatalog.preferred},fallback=${realtimeCatalog.fallback}`,
      primarySurface: ['/api/realtime/bootstrap', '/socket.io/'],
      controlPlanePath: '/api/ops/realtime',
    },
    {
      capability: 'recommendation',
      owner: recommendationMode === 'off' ? 'node' : 'rust',
      nodeRole:
        recommendationMode === 'off'
          ? ['recommendation_primary', 'api_adapter']
          : ['provider_surface', 'api_adapter', 'shadow_compare'],
      fallbackEnabled: recommendationMode !== 'primary',
      fallbackMode:
        recommendationMode === 'primary'
          ? 'rust_primary'
          : recommendationMode === 'shadow'
            ? 'shadow_compare'
            : 'node_primary',
      primarySurface: ['/recommendation/candidates', '/internal/recommendation/*'],
      controlPlanePath: '/api/ops/recommendation',
    },
    {
      capability: 'platform',
      owner: goPlatformPrimary ? 'go' : 'node',
      nodeRole: goPlatformPrimary
        ? ['control_plane', 'event_publisher', 'fallback_adapter']
        : ['platform_primary', 'event_publisher'],
      fallbackEnabled: !goPlatformPrimary,
      fallbackMode: `sync_wake=${syncWakeExecutionMode},presence=${presenceExecutionMode},notification=${notificationExecutionMode}`,
      primarySurface: ['/ops/summary', 'platform:events:v1'],
      controlPlanePath: '/api/ops/platform-bus',
    },
    {
      capability: 'graph',
      owner: graphKernelEnabled ? 'cpp' : 'node',
      nodeRole: graphKernelEnabled
        ? ['provider_surface', 'fallback_adapter']
        : ['graph_primary', 'provider_surface'],
      fallbackEnabled: graphKernelEnabled,
      fallbackMode: graphKernelEnabled
        ? (input.graphKernel?.available ? 'cpp_primary_with_node_legacy_fallback' : 'cpp_unavailable_node_legacy_fallback')
        : 'node_primary',
      primarySurface: ['/graph/social-neighbors', '/graph/recent-engagers', '/graph/co-engagers', '/graph/content-affinity-neighbors', '/graph/bridge-users'],
      controlPlanePath: '/api/ops/recommendation',
    },
  ];

  const summary = [
    'Summary:',
    '- Node strategic shape: public_rest_api, auth, uploads, data_access, control_plane, fallback_adapters',
    `- Realtime owner: ${capabilities[0].owner} (${capabilities[0].fallbackMode})`,
    `- Recommendation owner: ${capabilities[1].owner} (${capabilities[1].fallbackMode})`,
    `- Platform owner: ${capabilities[2].owner} (${capabilities[2].fallbackMode})`,
    `- Graph owner: ${capabilities[3].owner} (${capabilities[3].fallbackMode})`,
  ].join('\n');

  return {
    nodeStrategicShape: {
      owner: 'node',
      responsibilities: [
        'public_rest_api',
        'auth',
        'uploads',
        'data_access',
        'control_plane',
        'fallback_adapters',
      ],
      mode: 'api_control_fallback_plane',
    },
    capabilities,
    summary,
  };
}
