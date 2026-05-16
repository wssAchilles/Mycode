export async function readMessageFanoutQueueStats(): Promise<{ available: boolean; stats: Record<string, number> | null }> {
  try {
    const { QUEUE_NAMES, queueService } = await import('../../queueService');
    const stats = await queueService.getQueueStats(QUEUE_NAMES.MESSAGE_FANOUT);
    return {
      available: true,
      stats,
    };
  } catch {
    return {
      available: false,
      stats: null,
    };
  }
}
