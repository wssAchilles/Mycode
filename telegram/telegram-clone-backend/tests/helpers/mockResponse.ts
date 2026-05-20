import { Response } from 'express';

/**
 * 创建模拟 Express Response 对象
 */
export function createMockResponse(): Response & {
  _statusCode: number;
  _jsonBody: unknown;
  _headers: Record<string, string>;
} {
  const res = {
    _statusCode: 200,
    _jsonBody: undefined as unknown,
    _headers: {} as Record<string, string>,
    status(code: number) {
      res._statusCode = code;
      return res;
    },
    json(body: unknown) {
      res._jsonBody = body;
      return res;
    },
    setHeader(name: string, value: string) {
      res._headers[name] = value;
      return res;
    },
    set(headers: Record<string, string> | string, value?: string) {
      if (typeof headers === 'object') {
        Object.assign(res._headers, headers);
      } else if (typeof headers === 'string' && value) {
        res._headers[headers] = value;
      }
      return res;
    },
    send(body?: unknown) {
      res._jsonBody = body;
      return res;
    },
    redirect(url: string) {
      res._headers['Location'] = url;
      res._statusCode = 302;
      return res;
    },
  } as unknown as Response & {
    _statusCode: number;
    _jsonBody: unknown;
    _headers: Record<string, string>;
  };

  return res;
}

/**
 * 创建模拟 Express Request 对象
 */
export function createMockRequest(overrides: Record<string, unknown> = {}) {
  return {
    params: {},
    query: {},
    body: {},
    headers: {},
    user: undefined as { id: string; username: string } | undefined,
    userId: undefined as string | undefined,
    file: undefined as Express.Multer.File | undefined,
    ...overrides,
  } as any;
}
