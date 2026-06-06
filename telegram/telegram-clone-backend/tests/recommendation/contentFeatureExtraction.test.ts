import { describe, expect, it } from 'vitest';

import { inferContentSafetyCategories } from '../../src/services/recommendation/contentFeatures/featureExtraction';

describe('content feature extraction', () => {
    it('marks heuristic safety categories without claiming model inference', () => {
        const categories = inferContentSafetyCategories({
            content: 'Potential scam giveaway with nsfw media',
            isNews: true,
            media: [{ type: 'video/mp4' }],
        });

        expect(categories).toEqual([
            'adult_risk_keyword',
            'has_media',
            'has_video',
            'news_content',
            'spam_risk_keyword',
        ]);
    });
});
