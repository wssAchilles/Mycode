/**
 * DemographicsQueryHydrator - 用户人口统计特征
 * 从 User 模型加载 birthDate/region/language 并计算 age_range
 * 供 Rust 管道的 demographics scorer 使用
 */

import { QueryHydrator } from '../framework';
import { Demographics, FeedQuery } from '../types/FeedQuery';

export class DemographicsQueryHydrator implements QueryHydrator<FeedQuery> {
    readonly name = 'DemographicsQueryHydrator';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async hydrate(query: FeedQuery): Promise<FeedQuery> {
        const demographics = await this.loadDemographics(query.userId);
        return {
            ...query,
            demographics,
        };
    }

    update(query: FeedQuery, hydrated: Partial<FeedQuery>): FeedQuery {
        return {
            ...query,
            demographics: hydrated.demographics ?? query.demographics,
        };
    }

    private async loadDemographics(userId: string): Promise<Demographics | undefined> {
        try {
            const User = (await import('../../../models/User')).default;
            const user = await User.findByPk(userId, {
                attributes: ['birthDate', 'region', 'language'],
            });

            if (!user) return undefined;

            const demographics: Demographics = {};

            if (user.birthDate) {
                demographics.ageRange = this.computeAgeRange(user.birthDate);
            }
            if (user.region) {
                demographics.region = user.region;
            }
            if (user.language) {
                demographics.language = user.language;
            }

            return Object.keys(demographics).length > 0 ? demographics : undefined;
        } catch (error) {
            console.error('[DemographicsQueryHydrator] Failed to load demographics:', error);
            return undefined;
        }
    }

    private computeAgeRange(birthDate: Date): string {
        const now = new Date();
        const birth = new Date(birthDate);
        let age = now.getFullYear() - birth.getFullYear();
        const monthDiff = now.getMonth() - birth.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
            age--;
        }

        if (age < 18) return 'under_18';
        if (age < 25) return '18_24';
        if (age < 35) return '25_34';
        if (age < 45) return '35_44';
        if (age < 55) return '45_54';
        if (age < 65) return '55_64';
        return '65_plus';
    }
}
