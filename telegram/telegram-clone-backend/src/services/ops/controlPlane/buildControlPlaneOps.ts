import { runtimeControlPlane } from '../../controlPlane/runtimeControlPlane';
import { buildNodeCapabilityOwnershipSummary } from '../../controlPlane/capabilityOwners';
import { validateTaskPacket } from '../../controlPlane/taskPacket';
import { readDeliveryConsumerOpsSummary } from '../../chatDelivery/deliveryConsumerOps';
import { readGraphKernelOpsSummary } from '../../graphKernel/ops';

async function buildCapabilities() {
  const [consumer, graphKernel] = await Promise.all([
    readDeliveryConsumerOpsSummary(),
    readGraphKernelOpsSummary(),
  ]);
  return buildNodeCapabilityOwnershipSummary({
    consumer,
    graphKernel,
  });
}

export async function buildCapabilitiesOps() {
  return buildCapabilities();
}

export async function buildControlPlaneOps() {
  const capabilities = await buildCapabilities();
  return {
    ...runtimeControlPlane.snapshot(),
    capabilities,
  };
}

export async function buildControlPlaneSummaryOps() {
  const capabilities = await buildCapabilities();
  return {
    summary: runtimeControlPlane.summary(),
    capabilitiesSummary: capabilities.summary,
  };
}

export function validateTaskPacketOps(input: unknown) {
  return validateTaskPacket(input || {});
}
