import crypto from 'crypto';

import { REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT } from '../contracts/embeddingContract';

export interface RegisteredUserColdStartInput {
    id: string;
    username: string;
    region?: string | null;
    language?: string | null;
}

export function canonicalRegisteredUserColdStartInput(
    input: RegisteredUserColdStartInput,
): Required<RegisteredUserColdStartInput> {
    return {
        id: String(input.id),
        username: String(input.username),
        region: String(input.region || ''),
        language: String(input.language || ''),
    };
}

export function buildRegisteredUserColdStartEmbedding(
    input: RegisteredUserColdStartInput,
): number[] {
    const canonical = canonicalRegisteredUserColdStartInput(input);
    const dimensions = REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT.retrievalEmbeddingDim;
    const values: number[] = [];
    let seed = [canonical.id, canonical.username, canonical.region, canonical.language].join('|');

    while (values.length < dimensions) {
        const hash = crypto.createHash('sha256').update(seed).digest();
        for (const byte of hash) {
            values.push((byte / 255) * 2 - 1);
            if (values.length >= dimensions) break;
        }
        seed = hash.toString('hex');
    }

    const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
    return values.map((value) => Number((value / norm).toFixed(8)));
}
