export type SocialPhoenixTask =
    | 'click'
    | 'like'
    | 'reply'
    | 'repost'
    | 'quote'
    | 'share'
    | 'engagement'
    | 'negative';

export type SocialPhoenixFeatureMap = Record<string, number>;

export interface SocialPhoenixLinearTaskModel {
    bias: number;
    weights: Record<string, number>;
}

export interface SocialPhoenixLinearModel {
    version: number;
    trainedAt: string;
    features: string[];
    tasks: Record<SocialPhoenixTask, SocialPhoenixLinearTaskModel>;
    metadata?: Record<string, unknown>;
}
