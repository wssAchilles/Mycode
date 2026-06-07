import { ActionType } from '../../../models/UserAction';
import { ProductSurface, SignalType, TargetType } from '../../../models/UserSignal';
import type { RecommendationEventInput, RecommendationEventType } from './types';

const SIGNAL_BY_EVENT: Partial<Record<RecommendationEventType, SignalType>> = {
    impression: SignalType.IMPRESSION,
    click: SignalType.TWEET_CLICK,
    profile_click: SignalType.PROFILE_CLICK,
    like: SignalType.FAVORITE,
    unlike: SignalType.UNFAVORITE,
    reply: SignalType.REPLY,
    repost: SignalType.RETWEET,
    unrepost: SignalType.UNRETWEET,
    quote: SignalType.QUOTE,
    share: SignalType.SHARE,
    dwell: SignalType.DWELL,
    dismiss: SignalType.DISMISS_POST,
    hide: SignalType.HIDE_POST,
    report: SignalType.REPORT,
    block: SignalType.BLOCK,
    mute: SignalType.MUTE,
    follow: SignalType.FOLLOW,
    unfollow: SignalType.UNFOLLOW,
};

const ACTION_BY_EVENT: Partial<Record<RecommendationEventType, ActionType>> = {
    delivery: ActionType.DELIVERY,
    impression: ActionType.IMPRESSION,
    click: ActionType.CLICK,
    profile_click: ActionType.PROFILE_CLICK,
    like: ActionType.LIKE,
    reply: ActionType.REPLY,
    repost: ActionType.REPOST,
    quote: ActionType.QUOTE,
    share: ActionType.SHARE,
    dwell: ActionType.DWELL,
    dismiss: ActionType.DISMISS,
    hide: ActionType.HIDE,
    report: ActionType.REPORT,
    block: ActionType.BLOCK_AUTHOR,
};

export function mapEventToSignalType(eventType: RecommendationEventType): SignalType | null {
    return SIGNAL_BY_EVENT[eventType] || null;
}

export function mapEventToActionType(eventType: RecommendationEventType): ActionType | null {
    return ACTION_BY_EVENT[eventType] || null;
}

export function normalizeTargetType(value: RecommendationEventInput['targetType']): TargetType {
    if (!value) return TargetType.POST;
    if (Object.values(TargetType).includes(value as TargetType)) return value as TargetType;
    return TargetType.POST;
}

export function normalizeProductSurface(value: RecommendationEventInput['productSurface']): ProductSurface {
    if (!value) return ProductSurface.SPACE_FEED;
    if (Object.values(ProductSurface).includes(value as ProductSurface)) return value as ProductSurface;
    return ProductSurface.SPACE_FEED;
}
