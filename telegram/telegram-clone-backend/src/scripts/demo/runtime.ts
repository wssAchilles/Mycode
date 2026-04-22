import fs from 'node:fs';
import path from 'node:path';

import mongoose from 'mongoose';

import { connectMongoDB } from '../../config/db';
import { connectRedis, redis } from '../../config/redis';
import { sequelize } from '../../config/sequelize';
import type { FrontendTargetInfo } from './contracts';

const normalizeBaseUrl = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
};

const parseEnvFile = (filePath: string): Record<string, string> => {
  if (!fs.existsSync(filePath)) return {};
  const entries: Record<string, string> = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
};

export const getBackendRoot = (): string => process.cwd();

export const getRepoRoot = (): string => path.resolve(getBackendRoot(), '..');

export const resolveFrontendTargets = (): FrontendTargetInfo[] => {
  const frontendRoot = path.resolve(getRepoRoot(), 'telegram-clone-frontend');
  const candidateFiles = ['.env', '.env.production'].map((file) => path.resolve(frontendRoot, file));
  return candidateFiles
    .filter((file) => fs.existsSync(file))
    .map((file) => {
      const parsed = parseEnvFile(file);
      return {
        file,
        apiBaseUrl: normalizeBaseUrl(parsed.VITE_API_BASE_URL || null),
        socketUrl: normalizeBaseUrl(parsed.VITE_SOCKET_URL || null),
      };
    });
};

export const resolvePublicApiBaseUrl = (): string | null => {
  const envCandidates = [
    process.env.DEMO_PUBLIC_API_BASE_URL,
    process.env.VITE_API_BASE_URL,
    process.env.API_BASE_URL,
    process.env.PUBLIC_API_BASE_URL,
    process.env.APP_BASE_URL,
  ];

  for (const candidate of envCandidates) {
    const normalized = normalizeBaseUrl(candidate || null);
    if (normalized) return normalized;
  }

  for (const target of resolveFrontendTargets()) {
    if (target.apiBaseUrl) return target.apiBaseUrl;
  }

  return null;
};

export const buildFrontendTargetWarnings = (publicApiBaseUrl: string | null): string[] => {
  const warnings: string[] = [];
  if (!publicApiBaseUrl) {
    warnings.push('Could not resolve a public API base URL. Relative Space uploads may not work for group avatars outside direct S3 URLs.');
    return warnings;
  }

  const targets = resolveFrontendTargets();
  for (const target of targets) {
    if (target.apiBaseUrl && target.apiBaseUrl !== publicApiBaseUrl) {
      warnings.push(`Frontend API target mismatch: ${target.file} -> ${target.apiBaseUrl} (demo expects ${publicApiBaseUrl})`);
    }
    if (target.socketUrl && target.socketUrl !== publicApiBaseUrl) {
      warnings.push(`Frontend socket target mismatch: ${target.file} -> ${target.socketUrl} (demo expects ${publicApiBaseUrl})`);
    }
  }
  return warnings;
};

export const absolutizePublicUrl = (
  value: string | null | undefined,
  publicApiBaseUrl: string | null,
): string | null => {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (!publicApiBaseUrl) return null;
  return `${publicApiBaseUrl}${value.startsWith('/') ? '' : '/'}${value}`;
};

export const connectDemoStores = async (): Promise<void> => {
  await sequelize.authenticate();
  await connectMongoDB();
  if ((redis as any).status !== 'ready') {
    await connectRedis();
  }
};

export const disconnectDemoStores = async (): Promise<void> => {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  } catch {
    // best effort
  }

  try {
    const status = (redis as any).status;
    if (status === 'ready' || status === 'connect' || status === 'connecting') {
      await redis.quit();
    }
  } catch {
    // best effort
  }

  try {
    await sequelize.close();
  } catch {
    // best effort
  }
};
