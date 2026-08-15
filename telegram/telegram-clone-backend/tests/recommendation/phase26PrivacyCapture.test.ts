import { describe, expect, it } from 'vitest';

import {
    buildRecommendationViewerPseudonymV1,
    isVerifiedRecommendationViewerPseudonymV1,
} from '../../src/services/recommendation/evidenceCapture/privacy';

const baseInput = {
    masterKey: Buffer.alloc(32, 7),
    viewerId: 'viewer-42',
    keyVersion: 'key-v1',
    captureEpochId: 'epoch-2026-08',
};

describe('Phase 26 viewer pseudonym capture', () => {
    it('derives a deterministic development-only pseudonym without raw identifiers', () => {
        const callerKeyBefore = Buffer.from(baseInput.masterKey);
        const first = buildRecommendationViewerPseudonymV1(baseInput);
        const second = buildRecommendationViewerPseudonymV1(baseInput);

        expect(first.status).toBe('verified');
        expect(second.status).toBe('verified');
        if (first.status !== 'verified' || second.status !== 'verified') return;
        expect(first.pseudonym).toEqual(second.pseudonym);
        expect(isVerifiedRecommendationViewerPseudonymV1(first.pseudonym)).toBe(true);
        expect(first.pseudonym.viewerAccountPseudonym).toBe(
            '1954fbb0a17de0b34058f53373a342c0df282d19a4bca1a2daf5ddf735e9b781',
        );
        expect(first.pseudonym.pseudonymReceiptSha256).toBe(
            '214053690a22579f7befa0f3fd02d99934134459f293f6c6b1b4c5e42aa9ec0f',
        );
        expect(JSON.stringify(first.pseudonym)).not.toContain(baseInput.viewerId);
        expect(JSON.stringify(first.pseudonym)).not.toContain(baseInput.masterKey.toString('hex'));
        expect(baseInput.masterKey).toEqual(callerKeyBefore);
        expect(first.pseudonym.realDatasetEligible).toBe(false);
        expect(first.pseudonym.servable).toBe(false);
    });

    it('separates key and epoch domains', () => {
        const baseline = buildRecommendationViewerPseudonymV1(baseInput);
        const keyChanged = buildRecommendationViewerPseudonymV1({
            ...baseInput,
            keyVersion: 'key-v2',
        });
        const epochChanged = buildRecommendationViewerPseudonymV1({
            ...baseInput,
            captureEpochId: 'epoch-2026-09',
        });

        expect(baseline.status).toBe('verified');
        expect(keyChanged.status).toBe('verified');
        expect(epochChanged.status).toBe('verified');
        if (baseline.status !== 'verified' || keyChanged.status !== 'verified' || epochChanged.status !== 'verified') return;
        expect(keyChanged.pseudonym.viewerAccountPseudonym).not.toBe(
            baseline.pseudonym.viewerAccountPseudonym,
        );
        expect(epochChanged.pseudonym.viewerAccountPseudonym).not.toBe(
            keyChanged.pseudonym.viewerAccountPseudonym,
        );
    });

    it('rejects invalid keys and resource-overflowing identifiers before cryptography', () => {
        expect(buildRecommendationViewerPseudonymV1({
            ...baseInput,
            masterKey: Buffer.alloc(31),
        })).toEqual({ status: 'not_evaluable', blocker: 'viewer_pseudonym_key_invalid' });

        expect(buildRecommendationViewerPseudonymV1({
            ...baseInput,
            viewerId: 'v'.repeat(257),
        })).toEqual({
            status: 'not_evaluable',
            blocker: 'viewer_pseudonym_resource_limit_exceeded',
        });
    });

    it('fails closed for plain clones and hostile getters', () => {
        const verified = buildRecommendationViewerPseudonymV1(baseInput);
        expect(verified.status).toBe('verified');
        if (verified.status !== 'verified') return;
        expect(isVerifiedRecommendationViewerPseudonymV1({ ...verified.pseudonym })).toBe(false);

        const throwing = Object.defineProperty({}, 'masterKey', {
            get() {
                throw new Error('hostile getter');
            },
        });
        expect(buildRecommendationViewerPseudonymV1(throwing)).toEqual({
            status: 'not_evaluable',
            blocker: 'viewer_pseudonym_input_invalid',
        });
    });
});
