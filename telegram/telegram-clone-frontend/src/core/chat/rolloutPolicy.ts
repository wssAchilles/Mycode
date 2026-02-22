import { runtimeFlags } from './runtimeFlags';

const env = import.meta.env;
const DEFAULT_POLICY_MATRIX_VERSION = '2026.02.m1';

function readPercent(name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  if (normalized < 0) return 0;
  if (normalized > 100) return 100;
  return normalized;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = String(raw).trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  return fallback;
}

function readString(name: string, fallback: string): string {
  const raw = env[name];
  if (raw === undefined || raw === null) return fallback;
  const value = String(raw).trim();
  return value || fallback;
}

export type ChatPolicyProfile = 'baseline' | 'canary' | 'safe';
export type ChatPolicySource = 'percent_rollout' | 'manual_locked' | 'emergency_safe_mode';

function readProfile(name: string): ChatPolicyProfile | null {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === '') return null;
  const value = String(raw).trim().toLowerCase();
  if (value === 'baseline' || value === 'canary' || value === 'safe') {
    return value;
  }
  return null;
}

function hashToBucket(input: string): number {
  // FNV-1a 32-bit for deterministic rollout bucketing.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}

function enabledInPercent(userId: string, key: string, percent: number): boolean {
  if (percent >= 100) return true;
  if (percent <= 0) return false;
  const bucket = hashToBucket(`${key}:${userId}`);
  return bucket < percent;
}

export type ChatRuntimePolicy = {
  profile: ChatPolicyProfile;
  profileLocked: boolean;
  profileSource: ChatPolicySource;
  matrixVersion: string;
  emergencySafeMode: boolean;
  enableWorkerSocket: boolean;
  enableWorkerSyncFallback: boolean;
  enableWorkerSafetyChecks: boolean;
  enableSearchTieredIndex: boolean;
  enableSearchTieredWasm: boolean;
  enableMediaWorkerPool: boolean;
  rollout: {
    socketPercent: number;
    safetyChecksPercent: number;
    mediaPoolPercent: number;
  };
};

export function resolveChatRuntimePolicy(userId: string): ChatRuntimePolicy {
  const emergencySafeMode = readBool('VITE_CHAT_EMERGENCY_SAFE_MODE', false);
  const matrixVersion = readString('VITE_CHAT_POLICY_MATRIX_VERSION', DEFAULT_POLICY_MATRIX_VERSION);
  const profileLocked = readBool('VITE_CHAT_POLICY_PROFILE_LOCKED', false);
  const manualProfile = readProfile('VITE_CHAT_POLICY_PROFILE');

  const socketPercent = readPercent('VITE_CHAT_ROLLOUT_SOCKET_PERCENT', 100);
  const safetyChecksPercent = readPercent('VITE_CHAT_ROLLOUT_SAFETY_CHECKS_PERCENT', 100);
  const mediaPoolPercent = readPercent('VITE_CHAT_ROLLOUT_MEDIA_POOL_PERCENT', 100);
  const workerSocketCanary =
    runtimeFlags.workerSocketEnabled && enabledInPercent(userId, 'socket', socketPercent);
  const workerSafetyCanary =
    runtimeFlags.workerSafetyChecks && enabledInPercent(userId, 'safety', safetyChecksPercent);
  const mediaPoolCanary =
    runtimeFlags.mediaWorkerPoolEnabled && enabledInPercent(userId, 'media', mediaPoolPercent);

  const buildPolicy = (profile: ChatPolicyProfile, source: ChatPolicySource): ChatRuntimePolicy => {
    if (profile === 'safe') {
      return {
        profile,
        profileLocked: source === 'manual_locked',
        profileSource: source,
        matrixVersion,
        emergencySafeMode: source === 'emergency_safe_mode',
        enableWorkerSocket: false,
        enableWorkerSyncFallback: true,
        enableWorkerSafetyChecks: false,
        enableSearchTieredIndex: true,
        enableSearchTieredWasm: false,
        enableMediaWorkerPool: false,
        rollout: {
          socketPercent,
          safetyChecksPercent,
          mediaPoolPercent,
        },
      };
    }

    if (profile === 'canary') {
      return {
        profile,
        profileLocked: source === 'manual_locked',
        profileSource: source,
        matrixVersion,
        emergencySafeMode: false,
        enableWorkerSocket: workerSocketCanary,
        enableWorkerSyncFallback: runtimeFlags.workerSyncFallback,
        enableWorkerSafetyChecks: workerSafetyCanary,
        enableSearchTieredIndex: runtimeFlags.searchTieredIndex,
        enableSearchTieredWasm: runtimeFlags.searchTieredWasm,
        enableMediaWorkerPool: mediaPoolCanary,
        rollout: {
          socketPercent,
          safetyChecksPercent,
          mediaPoolPercent,
        },
      };
    }

    return {
      profile: 'baseline',
      profileLocked: source === 'manual_locked',
      profileSource: source,
      matrixVersion,
      emergencySafeMode: false,
      enableWorkerSocket: runtimeFlags.workerSocketEnabled,
      enableWorkerSyncFallback: runtimeFlags.workerSyncFallback,
      enableWorkerSafetyChecks: runtimeFlags.workerSafetyChecks,
      enableSearchTieredIndex: runtimeFlags.searchTieredIndex,
      enableSearchTieredWasm: runtimeFlags.searchTieredWasm,
      enableMediaWorkerPool: runtimeFlags.mediaWorkerPoolEnabled,
      rollout: {
        socketPercent,
        safetyChecksPercent,
        mediaPoolPercent,
      },
    };
  };

  if (emergencySafeMode) {
    return buildPolicy('safe', 'emergency_safe_mode');
  }

  if (profileLocked && manualProfile) {
    return buildPolicy(manualProfile, 'manual_locked');
  }

  const profile =
    socketPercent < 100 || safetyChecksPercent < 100 || mediaPoolPercent < 100 ? 'canary' : 'baseline';

  return buildPolicy(profile, 'percent_rollout');
}
