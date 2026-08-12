import axios, { AxiosInstance } from 'axios';
import type { EmbeddingContract } from '../contracts/embeddingContract';

export interface AnnCandidate {
    postId: string;
    score: number;
}

export type AnnOutcome =
    | 'success'
    | 'empty'
    | 'contract_mismatch'
    | 'timeout'
    | 'transport_error'
    | 'invalid_response';

export interface AnnResponseEvidence {
    embeddingSpace: string;
    retrievalEmbeddingDim: number;
    modelVersion: string;
    artifactVersion: string;
    idNamespace: string;
    indexVersion: string;
}

export interface AnnAttempt {
    outcome: AnnOutcome;
    requestedK: number;
    returnedK: number;
    latencyMs: number;
    candidates: AnnCandidate[];
    responseEvidence?: AnnResponseEvidence;
}

export interface AnnRequest {
    userId: string;
    keywords: string[];
    historyPostIds: string[];
    topK: number;
    embeddingContract?: Partial<EmbeddingContract>;
    corpusContract?: Partial<EmbeddingContract>;
    expectedEvidence?: Partial<AnnResponseEvidence>;
}

export interface AnnRetrieveOptions {
    deadlineMs?: number;
}

export interface AnnClient {
    retrieve(request: AnnRequest, options?: AnnRetrieveOptions): Promise<AnnAttempt>;
    healthCheck?(): Promise<AnnHealthStatus>;
}

export async function retrieveAnnWithinBudget(
    client: AnnClient,
    request: AnnRequest,
    budgetMs: number,
): Promise<AnnAttempt> {
    const start = Date.now();
    const timeoutMs = Math.max(1, Math.round(budgetMs));
    const deadlineMs = start + timeoutMs;
    let timer: NodeJS.Timeout | undefined;
    const retrieval = Promise.resolve()
        .then(() => client.retrieve(request, { deadlineMs }))
        .then((attempt) => (
            isTerminalAnnAttempt(attempt, request.topK)
                ? attempt
                : terminalAttempt('invalid_response', request.topK, start)
        ))
        .catch((error: unknown) => terminalAttempt(
            isTimeoutError(error) || Date.now() >= deadlineMs ? 'timeout' : 'transport_error',
            request.topK,
            start,
        ));
    const timeout = new Promise<AnnAttempt>((resolve) => {
        timer = setTimeout(
            () => resolve(terminalAttempt('timeout', request.topK, start)),
            timeoutMs,
        );
    });

    try {
        return await Promise.race([retrieval, timeout]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export interface AnnCorpusComparisonContract extends AnnResponseEvidence {
    metric: string;
    normalization: string;
}

export interface AnnComparisonContract extends AnnCorpusComparisonContract {
    queryVectorDigest: string;
}

export type AnnComparison =
    | {
        status: 'skipped';
        reason: 'exact_baseline_unavailable' | 'comparison_contract_mismatch';
        evaluationKs: number[];
    }
    | {
        status: 'compared';
        evaluationKs: number[];
        atK: Array<{ k: number; recall: number; overlap: number }>;
    };

export interface AnnComparisonInput {
    evaluationKs: number[];
    annIds: string[];
    annEvidence?: AnnResponseEvidence;
    queryContract?: AnnComparisonContract;
    corpusContract?: AnnCorpusComparisonContract;
    exactBaseline?: {
        ids: string[];
        contract: AnnComparisonContract;
    };
}

/**
 * ANN 服务健康状态
 */
export interface AnnHealthStatus {
    status: 'ok' | 'error';
    modelsLoaded: boolean;
    faissEnabled: boolean;
    faissIndexType: string | null;
    latencyMs?: number;
}

/**
 * ANN Client 配置
 */
export interface AnnClientConfig {
    /** 服务端点 */
    endpoint: string;
    /** 超时时间 (ms) */
    timeoutMs?: number;
    /** 重试次数 */
    retries?: number;
    /** 重试延迟 (ms) */
    retryDelayMs?: number;
}

/**
 * HTTP ANN Client - FAISS 加速版
 * 支持健康检查、自动重试、超时控制
 */
export class HttpAnnClient implements AnnClient {
    private client: AxiosInstance;
    private config: Required<AnnClientConfig>;

    constructor(endpointOrConfig: string | AnnClientConfig) {
        if (typeof endpointOrConfig === 'string') {
            this.config = {
                endpoint: endpointOrConfig,
                timeoutMs: 3000,
                retries: 2,
                retryDelayMs: 100,
            };
        } else {
            this.config = {
                endpoint: endpointOrConfig.endpoint,
                timeoutMs: endpointOrConfig.timeoutMs ?? 3000,
                retries: endpointOrConfig.retries ?? 2,
                retryDelayMs: endpointOrConfig.retryDelayMs ?? 100,
            };
        }

        this.client = axios.create({
            baseURL: this.config.endpoint,
            timeout: this.config.timeoutMs,
        });
    }

    /**
     * 健康检查
     */
    async healthCheck(): Promise<AnnHealthStatus> {
        const start = Date.now();
        try {
            // 构造健康检查 URL
            const healthUrl = this.config.endpoint.replace(/\/ann\/retrieve\/?$/, '/health');
            const res = await axios.get(healthUrl, { timeout: 2000 });
            return {
                status: 'ok',
                modelsLoaded: res.data?.models_loaded ?? false,
                faissEnabled: res.data?.faiss_enabled ?? false,
                faissIndexType: res.data?.faiss_index_type ?? null,
                latencyMs: Date.now() - start,
            };
        } catch (error) {
            return {
                status: 'error',
                modelsLoaded: false,
                faissEnabled: false,
                faissIndexType: null,
                latencyMs: Date.now() - start,
            };
        }
    }

    /**
     * ANN 检索 (支持重试)
     */
    async retrieve(request: AnnRequest, options?: AnnRetrieveOptions): Promise<AnnAttempt> {
        const start = Date.now();
        const callerDeadline = Number(options?.deadlineMs);
        const deadline = Math.min(
            start + this.config.timeoutMs,
            Number.isFinite(callerDeadline) ? callerDeadline : Number.POSITIVE_INFINITY,
        );

        for (let attempt = 0; attempt <= this.config.retries; attempt++) {
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) {
                return terminalAttempt('timeout', request.topK, start);
            }

            try {
                const res = await this.withDeadline(
                    this.client.post('', request, { timeout: remainingMs }),
                    remainingMs,
                );
                return classifyResponse(res.data, request, start);
            } catch (error: unknown) {
                if (isTimeoutError(error) || Date.now() >= deadline) {
                    return terminalAttempt('timeout', request.topK, start);
                }

                if (attempt >= this.config.retries) {
                    return terminalAttempt('transport_error', request.topK, start);
                }

                const delayMs = this.config.retryDelayMs * (attempt + 1);
                const remainingBeforeDelay = deadline - Date.now();
                if (remainingBeforeDelay <= 0) {
                    return terminalAttempt('timeout', request.topK, start);
                }
                await this.delay(Math.min(delayMs, remainingBeforeDelay));
                if (delayMs >= remainingBeforeDelay) {
                    return terminalAttempt('timeout', request.topK, start);
                }
            }
        }

        return terminalAttempt('transport_error', request.topK, start);
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private withDeadline<T>(promise: Promise<T>, remainingMs: number): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => reject(ANN_DEADLINE_EXCEEDED), remainingMs);
            promise.then(
                (value) => {
                    clearTimeout(timer);
                    resolve(value);
                },
                (error) => {
                    clearTimeout(timer);
                    reject(error);
                },
            );
        });
    }
}

export function buildAnnEvaluationKs(servingK: number): number[] {
    return Array.from(new Set([20, 80, 200, Math.round(servingK)]))
        .filter((k) => Number.isFinite(k) && k > 0)
        .sort((left, right) => left - right);
}

export function compareAnnAgainstExact(input: AnnComparisonInput): AnnComparison {
    const evaluationKs = Array.from(new Set(input.evaluationKs))
        .filter((k) => Number.isInteger(k) && k > 0)
        .sort((left, right) => left - right);
    const exactIds = uniqueIds(input.exactBaseline?.ids || []);
    if (exactIds.length === 0) {
        return { status: 'skipped', reason: 'exact_baseline_unavailable', evaluationKs };
    }

    const exactContract = input.exactBaseline?.contract;
    if (
        !isCompleteQueryComparisonContract(input.queryContract)
        || !isCompleteCorpusComparisonContract(input.corpusContract)
        || !isCompleteQueryComparisonContract(exactContract)
        || !isCompleteResponseEvidence(input.annEvidence)
        || !sameCorpusComparisonContract(input.queryContract, input.corpusContract)
        || !sameQueryComparisonContract(input.queryContract, exactContract)
        || !sameResponseEvidence(input.queryContract, input.annEvidence)
    ) {
        return { status: 'skipped', reason: 'comparison_contract_mismatch', evaluationKs };
    }

    const annIds = uniqueIds(input.annIds);
    return {
        status: 'compared',
        evaluationKs,
        atK: evaluationKs.map((k) => {
            const exactAtK = exactIds.slice(0, k);
            const exactSet = new Set(exactAtK);
            const overlap = annIds.slice(0, k).filter((id) => exactSet.has(id)).length;
            return {
                k,
                recall: exactAtK.length > 0 ? overlap / exactAtK.length : 0,
                overlap,
            };
        }),
    };
}

const ANN_DEADLINE_EXCEEDED = Symbol('ann_deadline_exceeded');
const EVIDENCE_FIELDS: Array<keyof AnnResponseEvidence> = [
    'embeddingSpace',
    'retrievalEmbeddingDim',
    'modelVersion',
    'artifactVersion',
    'idNamespace',
    'indexVersion',
];

function classifyResponse(data: unknown, request: AnnRequest, start: number): AnnAttempt {
    if (!isRecord(data) || !Array.isArray(data.candidates)) {
        return terminalAttempt('invalid_response', request.topK, start);
    }

    const returnedK = data.candidates.length;
    const responseEvidence = parseResponseEvidence(data.evidence);
    if (!responseEvidence) {
        return terminalAttempt('invalid_response', request.topK, start, returnedK);
    }
    if (returnedK > request.topK) {
        return terminalAttempt(
            'invalid_response',
            request.topK,
            start,
            returnedK,
            responseEvidence,
        );
    }
    if (!data.candidates.every(isAnnCandidate)) {
        return terminalAttempt(
            'invalid_response',
            request.topK,
            start,
            returnedK,
            responseEvidence,
        );
    }
    if (evidenceMismatch(responseEvidence, request.expectedEvidence)) {
        return terminalAttempt(
            'contract_mismatch',
            request.topK,
            start,
            returnedK,
            responseEvidence,
        );
    }

    const candidates = data.candidates as AnnCandidate[];
    return {
        outcome: candidates.length > 0 ? 'success' : 'empty',
        requestedK: request.topK,
        returnedK,
        latencyMs: Date.now() - start,
        candidates,
        responseEvidence,
    };
}

function terminalAttempt(
    outcome: Exclude<AnnOutcome, 'success' | 'empty'>,
    requestedK: number,
    start: number,
    returnedK = 0,
    responseEvidence?: AnnResponseEvidence,
): AnnAttempt {
    return {
        outcome,
        requestedK,
        returnedK,
        latencyMs: Date.now() - start,
        candidates: [],
        ...(responseEvidence ? { responseEvidence } : {}),
    };
}

function parseResponseEvidence(value: unknown): AnnResponseEvidence | undefined {
    return isCompleteResponseEvidence(value) ? value : undefined;
}

function isCompleteResponseEvidence(value: unknown): value is AnnResponseEvidence {
    if (!isRecord(value)) return false;
    return isNonEmptyString(value.embeddingSpace)
        && Number.isInteger(value.retrievalEmbeddingDim)
        && Number(value.retrievalEmbeddingDim) > 0
        && isNonEmptyString(value.modelVersion)
        && isNonEmptyString(value.artifactVersion)
        && isNonEmptyString(value.idNamespace)
        && isNonEmptyString(value.indexVersion);
}

function isCompleteCorpusComparisonContract(value: unknown): value is AnnCorpusComparisonContract {
    return isCompleteResponseEvidence(value)
        && isRecord(value)
        && isNonEmptyString(value.metric)
        && isNonEmptyString(value.normalization);
}

function isCompleteQueryComparisonContract(value: unknown): value is AnnComparisonContract {
    return isCompleteCorpusComparisonContract(value)
        && isRecord(value)
        && isNonEmptyString(value.queryVectorDigest);
}

function evidenceMismatch(
    actual: AnnResponseEvidence,
    expected?: Partial<AnnResponseEvidence>,
): boolean {
    if (!expected) return false;
    return EVIDENCE_FIELDS.some((field) => (
        expected[field] !== undefined && actual[field] !== expected[field]
    ));
}

function sameResponseEvidence(
    left: AnnResponseEvidence,
    right: AnnResponseEvidence,
): boolean {
    return EVIDENCE_FIELDS.every((field) => left[field] === right[field]);
}

function sameCorpusComparisonContract(
    left: AnnCorpusComparisonContract,
    right: AnnCorpusComparisonContract,
): boolean {
    return sameResponseEvidence(left, right)
        && left.metric === right.metric
        && left.normalization === right.normalization;
}


function sameQueryComparisonContract(
    left: AnnComparisonContract,
    right: AnnComparisonContract,
): boolean {
    return sameCorpusComparisonContract(left, right)
        && left.queryVectorDigest === right.queryVectorDigest;
}

function isAnnCandidate(value: unknown): value is AnnCandidate {
    return isRecord(value)
        && isNonEmptyString(value.postId)
        && typeof value.score === 'number'
        && Number.isFinite(value.score);
}

function isTerminalAnnAttempt(value: unknown, requestedK: number): value is AnnAttempt {
    if (!isRecord(value)) return false;
    if (![
        'success',
        'empty',
        'contract_mismatch',
        'timeout',
        'transport_error',
        'invalid_response',
    ].includes(String(value.outcome))) return false;
    if (value.requestedK !== requestedK) return false;
    if (!Number.isInteger(value.returnedK) || Number(value.returnedK) < 0) return false;
    if (typeof value.latencyMs !== 'number' || !Number.isFinite(value.latencyMs) || value.latencyMs < 0) return false;
    if (!Array.isArray(value.candidates) || !value.candidates.every(isAnnCandidate)) return false;

    if (value.outcome === 'success') {
        return value.candidates.length > 0
            && value.returnedK === value.candidates.length
            && isCompleteResponseEvidence(value.responseEvidence);
    }
    if (value.candidates.length > 0) return false;
    if (value.outcome === 'empty') {
        return value.returnedK === 0 && isCompleteResponseEvidence(value.responseEvidence);
    }
    if (value.outcome === 'contract_mismatch') {
        return isCompleteResponseEvidence(value.responseEvidence);
    }
    return true;
}

function isTimeoutError(error: unknown): boolean {
    if (error === ANN_DEADLINE_EXCEEDED) return true;
    if (!isRecord(error)) return false;
    return error.code === 'ECONNABORTED'
        || error.code === 'ETIMEDOUT'
        || error.name === 'TimeoutError'
        || (typeof error.message === 'string' && /timeout/i.test(error.message));
}

function uniqueIds(ids: string[]): string[] {
    return Array.from(new Set(ids.filter(isNonEmptyString)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}
