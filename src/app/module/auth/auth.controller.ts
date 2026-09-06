import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { cookieUtils } from "../../utils/cookie.js";
import { AuthService } from "./auth.service.js";

const register = catchAsync(async (req: Request, res: Response) => {
    const result = await AuthService.register(req.body);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Account created successfully",
        data: result,
    });
});

const login = catchAsync(async (req: Request, res: Response) => {
    // req.ip is the real client address because app.ts sets trust proxy -
    // without that every attempt would look like it came from the proxy.
    const { accessToken, refreshToken, user } = await AuthService.login(req.body, {
        ip: req.ip,
        userAgent: req.get("user-agent"),
    });

    // Cookies ONLY. The tokens used to be in the body as well, so that a
    // non-browser caller could read them - but a body is readable by script
    // and an httpOnly cookie is not, and that difference is the entire point
    // of the flag. With them in the body, one XSS could call /auth/refresh and
    // walk off with a seven-day refresh token that httpOnly was supposed to
    // put out of reach.
    //
    // Making it opt-in would not have helped: an opt-in is part of the
    // request, and script that can make a request can set it. The only version
    // of this that holds is unconditional.
    //
    // Nothing is lost. A non-browser client reads Set-Cookie from this same
    // response - curl, mobile HTTP stacks and scripts all can - so the tokens
    // are exactly as available as they were, to everyone except script running
    // in somebody else's page.
    cookieUtils.setAuthCookies(res, accessToken, refreshToken);

    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Logged in successfully",
        data: { user },
    });
});

const refreshToken = catchAsync(async (req: Request, res: Response) => {
    const token = cookieUtils.getCookie(req, "refreshToken") ?? req.body?.refreshToken;
    const result = await AuthService.refreshToken(token);

    cookieUtils.setAuthCookies(res, result.accessToken, result.refreshToken);

    // Cookies only, for the reason in login above - and this endpoint is the
    // one that made it urgent. It mints a fresh refresh token from a cookie
    // the caller never has to read, so returning it in the body handed script
    // a credential it could not otherwise reach.
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Token refreshed successfully",
        data: null,
    });
});

const logout = catchAsync(async (req: Request, res: Response) => {
    cookieUtils.clearAuthCookies(res);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Logged out successfully",
        data: null,
    });
});

const getMe = catchAsync(async (req: Request, res: Response) => {
    const result = await AuthService.getMe(req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "User retrieved successfully",
        data: result,
    });
});

const updateMe = catchAsync(async (req: Request, res: Response) => {
    const result = await AuthService.updateMe(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Profile updated successfully",
        data: result,
    });
});

const changePassword = catchAsync(async (req: Request, res: Response) => {
    const result = await AuthService.changePassword(req.body, req.user as IRequestUser);

    // The password change bumped token_version, so the cookies in the browser
    // are already dead. Clearing them makes the client's state match.
    cookieUtils.clearAuthCookies(res);

    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Password changed successfully",
        data: result,
    });
});

const forgotPassword = catchAsync(async (req: Request, res: Response) => {
    const result = await AuthService.forgotPassword(req.body, { ip: req.ip });
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: result.message,
        data: result,
    });
});

const resetPassword = catchAsync(async (req: Request, res: Response) => {
    const result = await AuthService.resetPassword(req.body);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: result.message,
        data: result,
    });
});

export const AuthController = {
    register,
    login,
    refreshToken,
    logout,
    getMe,
    updateMe,
    changePassword,
    forgotPassword,
    resetPassword,
};
