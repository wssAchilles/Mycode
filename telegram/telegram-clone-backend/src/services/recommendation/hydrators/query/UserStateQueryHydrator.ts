import { QueryHydrator } from '../../framework';
import { FeedQuery } from '../../types/FeedQuery';
import { buildUserStateContext } from '../../utils/userState';

export class UserStateQueryHydrator implements QueryHydrator<FeedQuery> {
    readonly name = 'UserStateQueryHydrator';

    enable(_query: FeedQuery): boolean {
        return true;
    }

    async hydrate(query: FeedQuery): Promise<FeedQuery> {
        return {
            ...query,
            userStateContext: buildUserStateContext(query),
        };
    }

    update(query: FeedQuery, hydrated: Partial<FeedQuery>): FeedQuery {
        return {
            ...query,
            userStateContext: hydrated.userStateContext ?? query.userStateContext,
        };
    }
}
