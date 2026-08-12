export type {
    RecommendationEventBatchResult,
    RecommendationEventIdentity,
    RecommendationEventInput,
    RecommendationEventType,
} from './types';
export { buildRecommendationEventKey } from './types';
export { recordRecommendationEvent, recordRecommendationEvents } from './recordRecommendationEvent';
export {
    normalizeAnalyticsPositionMetadata,
    normalizeServedPosition,
    SERVED_POSITION_CONTRACT_VERSION,
} from './positionContract';
