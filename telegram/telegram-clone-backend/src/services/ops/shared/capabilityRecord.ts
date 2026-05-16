import { buildNodeCapabilityOwnershipSummary } from '../../controlPlane/capabilityOwners';

export function getCapabilityRecord(
  capabilities: ReturnType<typeof buildNodeCapabilityOwnershipSummary>,
  capability: 'realtime' | 'recommendation' | 'platform' | 'graph',
) {
  return capabilities.capabilities.find((entry) => entry.capability === capability) || null;
}
