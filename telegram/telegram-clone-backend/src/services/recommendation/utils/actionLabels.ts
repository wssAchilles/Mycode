import { ActionType } from '../../../models/UserAction';

export const LABEL_ACTION_TYPES = [
    ActionType.CLICK,
    ActionType.LIKE,
    ActionType.REPLY,
    ActionType.REPOST,
    ActionType.QUOTE,
    ActionType.SHARE,
    ActionType.DISMISS,
    ActionType.BLOCK_AUTHOR,
    ActionType.REPORT,
    ActionType.DWELL,
] as const;

export interface ActionLikeRecord {
    action: ActionType | string;
    timestamp: Date | string | number;
    dwellTimeMs?: number;
}

export interface ActionLabelSummary {
    click: boolean;
    like: boolean;
    reply: boolean;
    repost: boolean;
    quote: boolean;
    share: boolean;
    dismiss: boolean;
    blockAuthor: boolean;
    report: boolean;
    engagement: boolean;
    negative: boolean;
    dwellTimeMs: number;
}

export function summarizeActionsInWindow(
    impressionTimestamp: Date | string | number,
    actions: ActionLikeRecord[],
    windowMs: number
): ActionLabelSummary {
    const startMs = toMs(impressionTimestamp);
    const endMs = startMs + Math.max(0, windowMs);

    const summary: ActionLabelSummary = {
        click: false,
        like: false,
        reply: false,
        repost: false,
        quote: false,
        share: false,
        dismiss: false,
        blockAuthor: false,
        report: false,
        engagement: false,
        negative: false,
        dwellTimeMs: 0,
    };

    for (const action of actions) {
        const ts = toMs(action.timestamp);
        if (ts < startMs || ts > endMs) continue;

        switch (String(action.action)) {
            case ActionType.CLICK:
                summary.click = true;
                break;
            case ActionType.LIKE:
                summary.like = true;
                break;
            case ActionType.REPLY:
                summary.reply = true;
                break;
            case ActionType.REPOST:
                summary.repost = true;
                break;
            case ActionType.QUOTE:
                summary.quote = true;
                break;
            case ActionType.SHARE:
                summary.share = true;
                break;
            case ActionType.DISMISS:
                summary.dismiss = true;
                break;
            case ActionType.BLOCK_AUTHOR:
                summary.blockAuthor = true;
                break;
            case ActionType.REPORT:
                summary.report = true;
                break;
            case ActionType.DWELL:
                summary.dwellTimeMs = Math.max(summary.dwellTimeMs, action.dwellTimeMs || 0);
                break;
            default:
                break;
        }
    }

    summary.engagement = summary.like || summary.reply || summary.repost || summary.quote || summary.share;
    summary.negative = summary.dismiss || summary.blockAuthor || summary.report;
    return summary;
}

function toMs(value: Date | string | number): number {
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value.getTime();
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
}

