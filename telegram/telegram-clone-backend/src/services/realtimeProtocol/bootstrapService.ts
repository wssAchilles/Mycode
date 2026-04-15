import { updateService } from '../updateService';
import {
  buildRealtimeCapabilities,
  buildRealtimeTransportCatalog,
  REALTIME_PROTOCOL_VERSION,
  SYNC_PROTOCOL_VERSION,
  SYNC_WATERMARK_FIELD,
  type RealtimeBootstrapPayload,
  type RealtimeHealthPayload,
} from './contracts';
import { realtimeSessionRegistry } from './realtimeSessionRegistry';

export async function buildRealtimeHealthPayload(): Promise<RealtimeHealthPayload> {
  return {
    protocolVersion: REALTIME_PROTOCOL_VERSION,
    transport: buildRealtimeTransportCatalog(),
    capabilities: buildRealtimeCapabilities(),
  };
}

export async function buildRealtimeBootstrapPayload(userId: string): Promise<RealtimeBootstrapPayload> {
  const [serverPts, ackPts] = await Promise.all([
    updateService.getUpdateId(userId),
    updateService.getAckPts(userId),
  ]);
  const session = realtimeSessionRegistry.getUserSnapshot(userId);

  return {
    ...(await buildRealtimeHealthPayload()),
    sync: {
      protocolVersion: SYNC_PROTOCOL_VERSION,
      watermarkField: SYNC_WATERMARK_FIELD,
      serverPts,
      ackPts,
      lagPts: Math.max(0, serverPts - ackPts),
    },
    session,
  };
}
