/**
 * 全局错误处理中间件
 * 集中处理所有错误响应
 */
import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { AppError } from '../utils/AppError';
import { ErrorCode, sendError } from '../utils/apiResponse';

// 开发环境错误响应
const sendDevError = (err: AppError, res: Response): void => {
    res.status(err.statusCode).json({
        success: false,
        error: {
            code: err.code,
            message: err.message,
            details: err.details,
            stack: err.stack,
        },
    });
};

// 生产环境错误响应
const sendProdError = (err: AppError, res: Response): void => {
    // 操作性错误：发送给客户端
    if (err.isOperational) {
        sendError(res, err.code, err.message, err.details);
    } else {
        // 编程错误：不泄露详情
        console.error('💥 错误:', err);
        sendError(res, ErrorCode.INTERNAL_ERROR, '服务器内部错误');
    }
};

// 处理 Mongoose 验证错误
const handleValidationError = (err: any): AppError => {
    const errors = Object.values(err.errors).map((el: any) => el.message);
    return new AppError(`验证失败: ${errors.join('. ')}`, ErrorCode.VALIDATION_ERROR, errors);
};

// 处理 Mongoose 唯一性冲突
const handleDuplicateKeyError = (err: any): AppError => {
    const field = Object.keys(err.keyValue)[0];
    return new AppError(`${field} 已存在`, ErrorCode.CONFLICT);
};

// 处理 Mongoose CastError
const handleCastError = (err: any): AppError => {
    return new AppError(`无效的 ${err.path}: ${err.value}`, ErrorCode.BAD_REQUEST);
};

// 处理 JWT 错误
const handleJWTError = (): AppError => {
    return new AppError('无效的令牌，请重新登录', ErrorCode.UNAUTHORIZED);
};

// 处理 JWT 过期
const handleJWTExpiredError = (): AppError => {
    return new AppError('令牌已过期，请重新登录', ErrorCode.UNAUTHORIZED);
};

/**
 * 全局错误处理中间件
 */
export const errorHandler: ErrorRequestHandler = (
    err: any,
    req: Request,
    res: Response,
    _next: NextFunction
): void => {
    // 默认错误属性
    err.statusCode = err.statusCode || 500;
    err.code = err.code || ErrorCode.INTERNAL_ERROR;

    // 记录错误
    if (process.env.NODE_ENV !== 'test') {
        console.error(`❌ [${new Date().toISOString()}] ${req.method} ${req.url}`);
        console.error(`   Error: ${err.message}`);
        if (process.env.NODE_ENV === 'development') {
            console.error(err.stack);
        }
    }

    // 根据环境处理错误
    if (process.env.NODE_ENV === 'development') {
        sendDevError(err, res);
        return;
    }

    // 生产环境：转换已知错误类型
    let error = err;

    if (err.name === 'ValidationError') {
        error = handleValidationError(err);
    }
    if (err.code === 11000) {
        error = handleDuplicateKeyError(err);
    }
    if (err.name === 'CastError') {
        error = handleCastError(err);
    }
    if (err.name === 'JsonWebTokenError') {
        error = handleJWTError();
    }
    if (err.name === 'TokenExpiredError') {
        error = handleJWTExpiredError();
    }

    sendProdError(error, res);
};

/**
 * 404 处理中间件
 */
export const notFoundHandler = (
    req: Request,
    res: Response,
    _next: NextFunction
): void => {
    sendError(res, ErrorCode.NOT_FOUND, `路由 ${req.originalUrl} 不存在`);
};

/**
 * 异步处理包装器
 * 自动捕获异步错误并传递给错误处理中间件
 */
export const catchAsync = (
    fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        fn(req, res, next).catch(next);
    };
};

export default {
    errorHandler,
    notFoundHandler,
    catchAsync,
};
