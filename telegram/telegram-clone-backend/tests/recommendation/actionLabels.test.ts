import { describe, expect, it } from 'vitest';

import { ActionType } from '../../src/models/UserAction';
import { summarizeActionsInWindow } from '../../src/services/recommendation/utils/actionLabels';

describe('summarizeActionsInWindow', () => {
    it('extracts engagement and negative labels within window', () => {
        const impressionAt = new Date('2026-02-01T00:00:00.000Z');
        const actions = [
            { action: ActionType.CLICK, timestamp: new Date('2026-02-01T00:00:10.000Z') },
            { action: ActionType.LIKE, timestamp: new Date('2026-02-01T00:01:00.000Z') },
            { action: ActionType.DWELL, timestamp: new Date('2026-02-01T00:01:20.000Z'), dwellTimeMs: 3200 },
            { action: ActionType.REPORT, timestamp: new Date('2026-02-01T00:02:00.000Z') },
            // outside window
            { action: ActionType.REPLY, timestamp: new Date('2026-02-01T10:00:00.000Z') },
        ];

        const out = summarizeActionsInWindow(impressionAt, actions, 5 * 60 * 1000);
        expect(out.click).toBe(true);
        expect(out.like).toBe(true);
        expect(out.engagement).toBe(true);
        expect(out.report).toBe(true);
        expect(out.negative).toBe(true);
        expect(out.reply).toBe(false);
        expect(out.dwellTimeMs).toBe(3200);
    });
});

