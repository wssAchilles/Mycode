/**
 * AppError - 自定义应用错误类
 * 用于统一错误处理和分类
 */
import { ErrorCode } from '../utils/apiResponse';

export class AppError extends Error {
    public readonly statusCode: number;
    public readonly code: ErrorCode;
    public readonly isOperational: boolean;
    public readonly details?: any;

    constructor(
        message: string,
        code: ErrorCode = ErrorCode.INTERNAL_ERROR,
        details?: any
    ) {
        super(message);

        this.code = code;
        this.statusCode = this.getStatusCode(code);
        this.isOperational = true;
        this.details = details;

        // 捕获堆栈跟踪
        Error.captureStackTrace(this, this.constructor);

        // 设置原型
        Object.setPrototypeOf(this, AppError.prototype);
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
    badRequest: (message: string, details?: any) =>
        new AppError(message, ErrorCode.BAD_REQUEST, details),

    unauthorized: (message = '未授权访问') =>
        new AppError(message, ErrorCode.UNAUTHORIZED),

    forbidden: (message = '禁止访问') =>
        new AppError(message, ErrorCode.FORBIDDEN),

    notFound: (resource = '资源') =>
        new AppError(`${resource}未找到`, ErrorCode.NOT_FOUND),

    conflict: (message: string) =>
        new AppError(message, ErrorCode.CONFLICT),

    validation: (details: any) =>
        new AppError('验证失败', ErrorCode.VALIDATION_ERROR, details),

    internal: (message = '服务器内部错误') =>
        new AppError(message, ErrorCode.INTERNAL_ERROR),

    database: (message = '数据库错误') =>
        new AppError(message, ErrorCode.DATABASE_ERROR),

    unavailable: (message = '服务暂时不可用') =>
        new AppError(message, ErrorCode.SERVICE_UNAVAILABLE),
};

export default AppError;
