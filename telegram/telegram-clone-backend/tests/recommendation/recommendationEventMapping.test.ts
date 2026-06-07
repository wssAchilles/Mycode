import { describe, expect, it } from 'vitest';

import { mapEventToActionType, mapEventToSignalType } from '../../src/services/recommendation/events/eventMapping';
import { ActionType } from '../../src/models/UserAction';
import { SignalType } from '../../src/models/UserSignal';

describe('recommendation event mapping', () => {
    it('maps engagement events to durable actions and realtime signals', () => {
        expect(mapEventToActionType('like')).toBe(ActionType.LIKE);
        expect(mapEventToSignalType('like')).toBe(SignalType.FAVORITE);
        expect(mapEventToActionType('reply')).toBe(ActionType.REPLY);
        expect(mapEventToSignalType('reply')).toBe(SignalType.REPLY);
        expect(mapEventToActionType('dwell')).toBe(ActionType.DWELL);
        expect(mapEventToSignalType('dwell')).toBe(SignalType.DWELL);
    });

    it('keeps delivery as durable action only', () => {
        expect(mapEventToActionType('delivery')).toBe(ActionType.DELIVERY);
        expect(mapEventToSignalType('delivery')).toBeNull();
    });
});
