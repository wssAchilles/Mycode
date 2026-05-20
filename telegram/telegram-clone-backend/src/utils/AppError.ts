/**
 * AppError - 统一的应用错误类
 *
 * isOperational 区分：
 *   - true  (默认): 运维/业务错误，预期会发生，返回具体信息给客户端
 *   - false: 程序员错误（bug），不应暴露细节给客户端
 *
 * 用法：
 *   throw new AppError('用户不存在', ErrorCode.NOT_FOUND);
 *   throw new AppError('数据库不可用', ErrorCode.SERVICE_UNAVAILABLE, undefined, false);
 *   throw createError.notFound('用户');
 */
import { ErrorCode } from '../utils/apiResponse';

export class AppError extends Error {
    public readonly statusCode: number;
    public readonly code: ErrorCode;
    public readonly isOperational: boolean;
    public readonly details?: unknown;

    constructor(
        message: string,
        code: ErrorCode = ErrorCode.INTERNAL_ERROR,
        details?: unknown,
        isOperational: boolean = true,
    ) {
        super(message);
        this.name = 'AppError';
        this.code = code;
        this.statusCode = this.getStatusCode(code);
        this.isOperational = isOperational;
        this.details = details;

        Object.setPrototypeOf(this, new.target.prototype);
    }

    private getStatusCode(code: ErrorCode): number {
        const codeToStatus: Record<ErrorCode, number> = {
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
        return codeToStatus[code] || 500;
    }
}

// 便捷工厂方法
export const createError = {
    badRequest: (message: string, details?: unknown) =>
        new AppError(message, ErrorCode.BAD_REQUEST, details),

    unauthorized: (message = '未授权访问') =>
        new AppError(message, ErrorCode.UNAUTHORIZED),

    forbidden: (message = '禁止访问') =>
        new AppError(message, ErrorCode.FORBIDDEN),

    notFound: (resource = '资源') =>
        new AppError(`${resource}未找到`, ErrorCode.NOT_FOUND),

    conflict: (message: string) =>
        new AppError(message, ErrorCode.CONFLICT),

    validation: (details: unknown) =>
        new AppError('验证失败', ErrorCode.VALIDATION_ERROR, details),

    internal: (message = '服务器内部错误', isOperational = false) =>
        new AppError(message, ErrorCode.INTERNAL_ERROR, undefined, isOperational),

    database: (message = '数据库错误') =>
        new AppError(message, ErrorCode.DATABASE_ERROR),

    unavailable: (message = '服务暂时不可用') =>
        new AppError(message, ErrorCode.SERVICE_UNAVAILABLE),
};

export default AppError;
