import { buildNodeCapabilityOwnershipSummary } from '../../controlPlane/capabilityOwners';
import {
  REALTIME_PROTOCOL_VERSION,
  buildRealtimeRuntimeSemantics,
  buildRealtimeTransportCatalog,
  readRealtimeRolloutStage,
} from '../../realtimeProtocol/contracts';
import { realtimeDeliveryPublisher } from '../../realtimeProtocol/delivery/realtimeDeliveryPublisher';
import { realtimeOps } from '../../realtimeProtocol/realtimeOps';
import { realtimeSessionRegistry } from '../../realtimeProtocol/realtimeSessionRegistry';
import { realtimeEventPublisher } from '../../realtimeProtocol/realtimeEventPublisher';
import { getCapabilityRecord } from '../shared/capabilityRecord';

export async function buildRealtimeOps(): Promise<Record<string, unknown>> {
  const stage = readRealtimeRolloutStage();
  const runtime = buildRealtimeRuntimeSemantics(stage);
  const capabilities = buildNodeCapabilityOwnershipSummary();

  return {
    protocolVersion: REALTIME_PROTOCOL_VERSION,
    transport: buildRealtimeTransportCatalog(stage),
    ownership: getCapabilityRecord(capabilities, 'realtime'),
    runtime: {
      ...runtime,
      realtimeOwner: runtime.fanoutOwner,
      compatFallbackOwner: runtime.socketTerminator === 'rust' ? 'node' : 'rust',
    },
    registry: realtimeSessionRegistry.snapshot(),
    ops: realtimeOps.snapshot(),
    eventBus: await realtimeEventPublisher.buildSummary(),
    deliveryBus: await realtimeDeliveryPublisher.buildSummary(),
  };
}
