import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { errors } from '../utils/apiResponse';

type RequestPart = 'body' | 'query' | 'params';

/**
 * Zod 验证中间件工厂
 * @param schema - Zod schema
 * @param source - 验证的请求部分（默认 body）
 */
export function validate(schema: ZodSchema, source: RequestPart = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req[source]);
      // 将解析后的数据写回（Zod 可能有 transform/coerce）
      (req as any)[source] = parsed;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const message = error.issues.map((e: { message: string }) => e.message).join('; ');
        errors.badRequest(res, message);
        return;
      }
      next(error);
    }
  };
}
