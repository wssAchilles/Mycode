import * as jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

if (!JWT_SECRET || JWT_SECRET.trim().length < 16) {
  // 明确要求配置足够强度的密钥，避免使用弱/空/默认值
  throw new Error('JWT_SECRET 未配置或太短，请在环境变量中设置一个长度>=16的随机字符串');
}

// JWT Payload 接口
export interface JWTPayload {
  userId: string;
  username: string;
  iat?: number;
  exp?: number;
  jti?: string;
}

// 生成访问令牌
export const generateAccessToken = (payload: Omit<JWTPayload, 'iat' | 'exp'>): string => {
  return jwt.sign(
    payload,
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN,
      issuer: 'telegram-clone',
      audience: 'telegram-clone-users',
    } as jwt.SignOptions
  );
};

// 生成刷新令牌
export const generateRefreshToken = (payload: Omit<JWTPayload, 'iat' | 'exp'>, jti: string): string => {
  return jwt.sign(
    payload,
    JWT_SECRET,
    {
      expiresIn: JWT_REFRESH_EXPIRES_IN,
      issuer: 'telegram-clone',
      audience: 'telegram-clone-refresh',
      jwtid: jti,
    } as jwt.SignOptions
  );
};

// 验证访问令牌
export const verifyAccessToken = (token: string): Promise<JWTPayload> => {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      JWT_SECRET,
      {
        issuer: 'telegram-clone',
        audience: 'telegram-clone-users',
      } as jwt.VerifyOptions,
      (error: Error | null, decoded: any) => {
        if (error) {
          reject(error);
        } else {
          resolve(decoded as JWTPayload);
        }
      });
  });
};

// 验证刷新令牌
export const verifyRefreshToken = (token: string): Promise<JWTPayload> => {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      JWT_SECRET,
      {
        issuer: 'telegram-clone',
        audience: 'telegram-clone-refresh',
      } as jwt.VerifyOptions,
      (error: Error | null, decoded: any) => {
        if (error) {
          reject(error);
        } else {
          resolve(decoded as JWTPayload);
        }
      });
  });
};

// 从令牌中解码信息（不验证）- 用于调试
export const decodeToken = (token: string): JWTPayload | null => {
  try {
    return jwt.decode(token) as JWTPayload;
  } catch (error) {
    return null;
  }
};

// 生成令牌对（访问令牌 + 刷新令牌）
const parseDurationToSeconds = (input: string): number => {
  // 支持格式：15m, 7d, 24h, 3600s
  const match = String(input).match(/^(\d+)([smhd])?$/i);
  if (!match) return 0;
  const value = parseInt(match[1], 10);
  const unit = match[2]?.toLowerCase() || 's';
  switch (unit) {
    case 'd':
      return value * 86400;
    case 'h':
      return value * 3600;
    case 'm':
      return value * 60;
    default:
      return value;
  }
};

export const getRefreshTtlSeconds = (): number => parseDurationToSeconds(JWT_REFRESH_EXPIRES_IN);

export const generateTokenPair = (payload: Omit<JWTPayload, 'iat' | 'exp'>) => {
  const jti = uuidv4();
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload, jti),
    refreshJti: jti,
  };
};
