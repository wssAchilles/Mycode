/**
 * 全局错误处理中间件
 */
import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { AppError } from '../utils/AppError';
import { ErrorCode, sendError } from '../utils/apiResponse';
import { createChildLogger } from '../utils/logger';

const log = createChildLogger('middleware:errorHandler');

const sendDevError = (err: AppError, res: Response): void => {
    res.status(err.statusCode).json({
        success: false,
        error: { code: err.code, message: err.message, details: err.details, stack: err.stack },
    });
};

const sendProdError = (err: AppError, res: Response): void => {
    if (err.isOperational) {
        sendError(res, err.code, err.message, err.details);
    } else {
        log.error({ err }, '非运维错误');
        sendError(res, ErrorCode.INTERNAL_ERROR, '服务器内部错误');
    }
};

const handleValidationError = (err: Record<string, unknown>): AppError => {
    const errors = Object.values(err.errors as Record<string, { message: string }>).map((el) => el.message);
    return new AppError(`验证失败: ${errors.join('. ')}`, ErrorCode.VALIDATION_ERROR, errors);
};

const handleDuplicateKeyError = (err: Record<string, unknown>): AppError => {
    const field = Object.keys(err.keyValue as Record<string, unknown>)[0];
    return new AppError(`${field} 已存在`, ErrorCode.CONFLICT);
};

const handleCastError = (err: Record<string, unknown>): AppError =>
    new AppError(`无效的 ${err.path}: ${err.value}`, ErrorCode.BAD_REQUEST);

const handleJWTError = (): AppError =>
    new AppError('无效的令牌，请重新登录', ErrorCode.UNAUTHORIZED);

const handleJWTExpiredError = (): AppError =>
    new AppError('令牌已过期，请重新登录', ErrorCode.UNAUTHORIZED);

export const errorHandler: ErrorRequestHandler = (
    err: unknown, req: Request, res: Response, _next: NextFunction,
): void => {
    const error = err instanceof AppError
        ? err
        : new AppError(err instanceof Error ? err.message : '未知错误', ErrorCode.INTERNAL_ERROR, undefined, false);

    error.statusCode = error.statusCode || 500;
    error.code = error.code || ErrorCode.INTERNAL_ERROR;

    if (process.env.NODE_ENV !== 'test') {
        log.error({ method: req.method, url: req.url, code: error.code, statusCode: error.statusCode, err: error }, '请求处理错误');
    }

    if (process.env.NODE_ENV === 'development') {
        sendDevError(error, res);
        return;
    }

    let converted = error;
    if (err instanceof Error && err.name === 'ValidationError') converted = handleValidationError(err as unknown as Record<string, unknown>);
    if (err instanceof Error && (err as unknown as Record<string, unknown>).code === 11000) converted = handleDuplicateKeyError(err as unknown as Record<string, unknown>);
    if (err instanceof Error && err.name === 'CastError') converted = handleCastError(err as unknown as Record<string, unknown>);
    if (err instanceof Error && err.name === 'JsonWebTokenError') converted = handleJWTError();
    if (err instanceof Error && err.name === 'TokenExpiredError') converted = handleJWTExpiredError();

    sendProdError(converted, res);
};

export const notFoundHandler = (req: Request, res: Response, _next: NextFunction): void => {
    sendError(res, ErrorCode.NOT_FOUND, `路由 ${req.originalUrl} 不存在`);
};

export const catchAsync = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction): void => { fn(req, res, next).catch(next); };

export default { errorHandler, notFoundHandler, catchAsync };
