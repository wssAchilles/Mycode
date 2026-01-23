/**
 * ExperimentQueryHydrator - 实验上下文填充器
 * 在 Pipeline 开始前为查询添加实验分流信息
 */

import { QueryHydrator } from '../framework';
import { FeedQuery } from '../types/FeedQuery';
import { getExperimentService, ExperimentService } from '../../experiment';

export class ExperimentQueryHydrator implements QueryHydrator<FeedQuery> {
    readonly name = 'ExperimentQueryHydrator';
    private experimentService: ExperimentService;

    constructor(experimentService?: ExperimentService) {
        this.experimentService = experimentService ?? getExperimentService();
    }

    enable(_query: FeedQuery): boolean {
        // 始终启用，让实验服务决定是否参与实验
        return true;
    }

    async hydrate(query: FeedQuery): Promise<FeedQuery> {
        try {
            const experimentContext = await this.experimentService.createContext(
                query.userId,
                {
                    userId: query.userId,
                    followerCount: query.userFeatures?.followerCount,
                    accountCreatedAt: query.userFeatures?.accountCreatedAt,
                }
            );

            return {
                ...query,
                experimentContext,
            };
        } catch (error) {
            console.error('[ExperimentQueryHydrator] Failed to create experiment context:', error);
            // 出错时返回原查询，不影响 Pipeline 执行
            return query;
        }
    }

    update(query: FeedQuery, hydrated: Partial<FeedQuery>): FeedQuery {
        return {
            ...query,
            experimentContext: hydrated.experimentContext ?? query.experimentContext,
        };
    }
}
