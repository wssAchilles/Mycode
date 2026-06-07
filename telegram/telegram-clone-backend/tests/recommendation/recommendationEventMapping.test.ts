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
        expect(mapEventToActionType('profile_click')).toBe(ActionType.PROFILE_CLICK);
        expect(mapEventToSignalType('profile_click')).toBe(SignalType.PROFILE_CLICK);
    });

    it('maps interest intent events to durable actions and realtime signals', () => {
        expect(mapEventToActionType('search_query')).toBe(ActionType.SEARCH_QUERY);
        expect(mapEventToSignalType('search_query')).toBe(SignalType.SEARCH_QUERY);
        expect(mapEventToActionType('hashtag_click')).toBe(ActionType.HASHTAG_CLICK);
        expect(mapEventToSignalType('hashtag_click')).toBe(SignalType.HASHTAG_CLICK);
        expect(mapEventToActionType('open_link')).toBe(ActionType.OPEN_LINK);
        expect(mapEventToSignalType('open_link')).toBe(SignalType.OPEN_LINK);
    });

    it('keeps delivery as durable action only', () => {
        expect(mapEventToActionType('delivery')).toBe(ActionType.DELIVERY);
        expect(mapEventToSignalType('delivery')).toBeNull();
    });
});
