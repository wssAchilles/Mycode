export interface StagedQueryHydrationResult<Q, R> {
    query: Q;
    results: R[];
}

export async function runStagedQueryHydrators<Q, H, R>(
    query: Q,
    hydrators: H[],
    stageFor: (hydrator: H) => number,
    execute: (hydrator: H, stageQuery: Q) => Promise<R>,
    merge: (query: Q, hydrator: H, result: R) => Q,
): Promise<StagedQueryHydrationResult<Q, R>> {
    const results = new Array<R>(hydrators.length);
    const stages = Array.from(new Set(hydrators.map(stageFor))).sort((left, right) => left - right);
    let current = query;

    for (const stage of stages) {
        const entries = hydrators
            .map((hydrator, index) => ({ hydrator, index }))
            .filter(({ hydrator }) => stageFor(hydrator) === stage);
        const stageQuery = current;
        const stageResults = await Promise.all(
            entries.map(({ hydrator }) => execute(hydrator, stageQuery)),
        );

        for (let index = 0; index < entries.length; index += 1) {
            const entry = entries[index];
            const result = stageResults[index];
            results[entry.index] = result;
            current = merge(current, entry.hydrator, result);
        }
    }

    return { query: current, results };
}
