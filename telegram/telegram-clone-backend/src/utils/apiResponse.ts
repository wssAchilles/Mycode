/**
 * ApiResponse - 统一 API 响应格式工具
 * 确保所有 API 返回一致的响应结构
 */
import { Response } from 'express';

// 成功响应结构
interface SuccessResponse<T> {
    success: true;
    data: T;
    message?: string;
    meta?: {
        page?: number;
        limit?: number;
        total?: number;
        totalPages?: number;
        hasMore?: boolean;
    };
}

// 错误响应结构
interface ErrorResponse {
    success: false;
    error: {
        code: string;
        message: string;
        details?: any;
    };
}

// 错误代码枚举
export enum ErrorCode {
    // 客户端错误 4xx
    BAD_REQUEST = 'BAD_REQUEST',
    UNAUTHORIZED = 'UNAUTHORIZED',
    FORBIDDEN = 'FORBIDDEN',
    NOT_FOUND = 'NOT_FOUND',
    CONFLICT = 'CONFLICT',
    VALIDATION_ERROR = 'VALIDATION_ERROR',
    RATE_LIMITED = 'RATE_LIMITED',

    // 服务器错误 5xx
    INTERNAL_ERROR = 'INTERNAL_ERROR',
    DATABASE_ERROR = 'DATABASE_ERROR',
    SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

// HTTP 状态码映射
const errorCodeToStatus: Record<ErrorCode, number> = {
    [ErrorCode.BAD_REQUEST]: 400,
    [ErrorCode.UNAUTHORIZED]: 401,
    [ErrorCode.FORBIDDEN]: 403,
    [ErrorCode.NOT_FOUND]: 404,
    [ErrorCode.CONFLICT]: 409,
    [ErrorCode.VALIDATION_ERROR]: 422,
    [ErrorCode.RATE_LIMITED]: 429,
    [ErrorCode.INTERNAL_ERROR]: 500,
    [ErrorCode.DATABASE_ERROR]: 500,
    [ErrorCode.SERVICE_UNAVAILABLE]: 503,
};

/**
 * 发送成功响应
 */
export function sendSuccess<T>(
    res: Response,
    data: T,
    options?: {
        message?: string;
        statusCode?: number;
        meta?: SuccessResponse<T>['meta'];
    }
): Response {
    const response: SuccessResponse<T> = {
        success: true,
        data,
    };

    if (options?.message) {
        response.message = options.message;
    }

    if (options?.meta) {
        response.meta = options.meta;
    }

    return res.status(options?.statusCode || 200).json(response);
}

/**
 * 发送错误响应
 */
export function sendError(
    res: Response,
    code: ErrorCode,
    message: string,
    details?: any
): Response {
    const statusCode = errorCodeToStatus[code] || 500;

    const response: ErrorResponse = {
        success: false,
        error: {
            code,
            message,
        },
    };

    if (details) {
        response.error.details = details;
    }

    return res.status(statusCode).json(response);
}

/**
 * 发送分页响应
 */
export function sendPaginated<T>(
    res: Response,
    data: T[],
    pagination: {
        page: number;
        limit: number;
        total: number;
    }
): Response {
    const totalPages = Math.ceil(pagination.total / pagination.limit);

    return sendSuccess(res, data, {
        meta: {
            page: pagination.page,
            limit: pagination.limit,
            total: pagination.total,
            totalPages,
            hasMore: pagination.page < totalPages,
        },
    });
}

/**
 * 发送创建成功响应
 */
export function sendCreated<T>(
    res: Response,
    data: T,
    message?: string
): Response {
    return sendSuccess(res, data, {
        statusCode: 201,
        message: message || '创建成功',
    });
}

/**
 * 发送无内容响应
 */
export function sendNoContent(res: Response): Response {
    return res.status(204).send();
}

// 便捷错误函数
export const errors = {
    badRequest: (res: Response, message: string, details?: any) =>
        sendError(res, ErrorCode.BAD_REQUEST, message, details),

    unauthorized: (res: Response, message = '未授权访问') =>
        sendError(res, ErrorCode.UNAUTHORIZED, message),

    forbidden: (res: Response, message = '禁止访问') =>
        sendError(res, ErrorCode.FORBIDDEN, message),

    notFound: (res: Response, resource = '资源') =>
        sendError(res, ErrorCode.NOT_FOUND, `${resource}未找到`),

    conflict: (res: Response, message: string) =>
        sendError(res, ErrorCode.CONFLICT, message),

    validation: (res: Response, details: any) =>
        sendError(res, ErrorCode.VALIDATION_ERROR, '验证失败', details),

    internal: (res: Response, message = '服务器内部错误') =>
        sendError(res, ErrorCode.INTERNAL_ERROR, message),

    database: (res: Response, message = '数据库错误') =>
        sendError(res, ErrorCode.DATABASE_ERROR, message),

    unavailable: (res: Response, message = '服务暂时不可用') =>
        sendError(res, ErrorCode.SERVICE_UNAVAILABLE, message),
};

export default {
    sendSuccess,
    sendError,
    sendPaginated,
    sendCreated,
    sendNoContent,
    errors,
    ErrorCode,
};
