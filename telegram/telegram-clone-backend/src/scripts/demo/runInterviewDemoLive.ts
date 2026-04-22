import { createAndFanoutMessage } from '../../services/messageWriteService';
import User from '../../models/User';
import { DEMO_GROUP_BLUEPRINTS, DEMO_GROUP_MESSAGE_THEMES, DEMO_LIVE_DEFAULT_DURATION_SEC, DEMO_LIVE_DEFAULT_MESSAGES_PER_MINUTE } from './config';
import { loadGroupMemberIds, loadPreparedDemoGroups } from './cohortStore';
import { connectDemoStores, disconnectDemoStores } from './runtime';

const parseNumberArg = (flag: string, fallback: number): number => {
  const direct = process.argv.find((value) => value.startsWith(`${flag}=`));
  const inline = direct ? Number.parseInt(direct.slice(flag.length + 1), 10) : NaN;
  if (Number.isFinite(inline) && inline > 0) return inline;
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) {
    const parsed = Number.parseInt(process.argv[index + 1], 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const durationSec = parseNumberArg('--duration-sec', DEMO_LIVE_DEFAULT_DURATION_SEC);
  const messagesPerMinute = parseNumberArg('--messages-per-minute', DEMO_LIVE_DEFAULT_MESSAGES_PER_MINUTE);
  const intervalMs = Math.max(150, Math.floor(60000 / messagesPerMinute));

  await connectDemoStores();
  try {
    const groups = await loadPreparedDemoGroups();
    const groupByName = new Map(groups.map((group) => [group.name, group]));
    const activeBlueprints = DEMO_GROUP_BLUEPRINTS.filter((group) =>
      group.slug === 'perf_arena' || group.slug === 'recsys_lab',
    );
    if (activeBlueprints.length === 0) {
      throw new Error('demo groups not found; run demo:prepare first');
    }

    const sendersByGroup = new Map<string, string[]>();
    for (const blueprint of activeBlueprints) {
      const group = groupByName.get(blueprint.name);
      if (!group) {
        throw new Error(`missing demo group ${blueprint.name}`);
      }
      const memberIds = await loadGroupMemberIds(group.id);
      const members = await User.findAll({
        where: { id: memberIds },
        attributes: ['id', 'username'],
        raw: true,
      });
      const preferred = members
        .filter((member: any) => !String(member.username || '').startsWith('demo_audience_'))
        .map((member: any) => member.id);
      const fallback = members.slice(0, 16).map((member: any) => member.id);
      sendersByGroup.set(group.id, preferred.length > 0 ? preferred : fallback);
    }

    const totalMessages = Math.max(1, Math.floor((durationSec * messagesPerMinute) / 60));
    let sent = 0;
    let blueprintCursor = 0;
    const weightedBlueprints = activeBlueprints.flatMap((blueprint) =>
      Array.from({ length: Math.max(1, Math.round(blueprint.liveWeight * 10)) }, () => blueprint),
    );

    console.log(`[demo:live] start duration=${durationSec}s rate=${messagesPerMinute}/min target=${totalMessages}`);

    while (sent < totalMessages) {
      const blueprint = weightedBlueprints[blueprintCursor % weightedBlueprints.length];
      blueprintCursor += 1;
      const group = groupByName.get(blueprint.name);
      if (!group) continue;
      const senderPool = sendersByGroup.get(group.id) || [];
      if (senderPool.length === 0) continue;

      const senderId = senderPool[sent % senderPool.length];
      const content = `${DEMO_GROUP_MESSAGE_THEMES[blueprint.slug][sent % DEMO_GROUP_MESSAGE_THEMES[blueprint.slug].length]} [live ${sent + 1}]`;

      await createAndFanoutMessage({
        senderId,
        groupId: group.id,
        chatType: 'group',
        content,
      });

      sent += 1;
      if (sent % 20 === 0 || sent === totalMessages) {
        console.log(`[demo:live] sent ${sent}/${totalMessages}`);
      }
      if (sent < totalMessages) {
        await sleep(intervalMs);
      }
    }

    console.log('[demo:live] completed');
  } finally {
    await disconnectDemoStores();
  }
}

main().catch(async (error) => {
  console.error('[demo:live] failed:', error);
  await disconnectDemoStores();
  process.exit(1);
});
