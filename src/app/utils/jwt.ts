import jwt, { SignOptions, JwtPayload } from 'jsonwebtoken';

const createToken = (payload: JwtPayload, secret: string, { expiresIn }: SignOptions) => {
  const token = jwt.sign(payload, secret, { expiresIn });
  return token;
};

type VerifyTokenSuccess = {
  success: true;
  decoded: JwtPayload;
  message: string;
};

type VerifyTokenFailure = {
  success: false;
  message: string;
  error: unknown;
};

type VerifyTokenResult = VerifyTokenSuccess | VerifyTokenFailure;

// Returns a result object rather than throwing: every caller wants to branch on
// "is this token usable", not wrap the call in a try/catch.
const verifyToken = (token: string, secret: string): VerifyTokenResult => {
  try {
    const decoded = jwt.verify(token, secret) as JwtPayload;
    return {
      success: true,
      decoded,
      message: 'Token verified successfully',
    };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    return {
      success: false,
      message: error.message,
      error: error,
    };
  }
};

const decodeToken = (token: string) => {
  const decoded = jwt.decode(token) as JwtPayload;
  return decoded;
};

export const jwtUtils = { createToken, verifyToken, decodeToken };
