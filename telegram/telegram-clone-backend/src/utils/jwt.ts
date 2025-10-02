import * as jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';

// JWT Payload 接口
export interface JWTPayload {
  userId: string;
  username: string;
  iat?: number;
  exp?: number;
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
export const generateRefreshToken = (payload: Omit<JWTPayload, 'iat' | 'exp'>): string => {
  return jwt.sign(
    payload,
    JWT_SECRET,
    {
      expiresIn: JWT_REFRESH_EXPIRES_IN,
      issuer: 'telegram-clone',
      audience: 'telegram-clone-refresh',
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
      (error, decoded) => {
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
      (error, decoded) => {
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
export const generateTokenPair = (payload: Omit<JWTPayload, 'iat' | 'exp'>) => {
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
  };
};
