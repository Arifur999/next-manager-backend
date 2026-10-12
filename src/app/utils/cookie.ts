import { Request, Response } from "express";
import { env } from "../../config/env.js";
import { jwtUtils } from "./jwt.js";

const isProduction = env.NODE_ENV === "production";

// SameSite=lax: same-site requests carry the cookie regardless, and refusing to
// send it from anyone else's page is what stops a cross-site request from acting
// as the signed-in user. "none" is only needed when the frontend and the API
// live on genuinely separate domains - and it needs secure=true to work at all.
const baseOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
};

const getCookie = (req: Request, name: string): string | undefined => {
    return req.cookies?.[name];
};

// The cookie lives exactly as long as the token inside it.
const lifetimeOf = (token: string) => {
    const exp: unknown = jwtUtils.decodeToken(token)?.exp;
    return typeof exp === "number" ? Math.max(exp * 1000 - Date.now(), 0) : undefined;
};

const setAuthCookies = (res: Response, accessToken: string, refreshToken: string) => {
    res.cookie("accessToken", accessToken, { ...baseOptions, maxAge: lifetimeOf(accessToken) });
    res.cookie("refreshToken", refreshToken, { ...baseOptions, maxAge: lifetimeOf(refreshToken) });
};

const clearAuthCookies = (res: Response) => {
    res.clearCookie("accessToken", baseOptions);
    res.clearCookie("refreshToken", baseOptions);
};

export const cookieUtils = { getCookie, setAuthCookies, clearAuthCookies };
