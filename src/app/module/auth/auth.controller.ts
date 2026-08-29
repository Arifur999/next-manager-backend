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
    const { accessToken, refreshToken, user } = await AuthService.login(req.body);

    // The tokens go into httpOnly cookies AND the body: the browser client
    // relies on the cookies, while a non-browser caller (mobile, scripts) reads
    // them from the response.
    cookieUtils.setAuthCookies(res, accessToken, refreshToken);

    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Logged in successfully",
        data: { accessToken, refreshToken, user },
    });
});

const refreshToken = catchAsync(async (req: Request, res: Response) => {
    const token = cookieUtils.getCookie(req, "refreshToken") ?? req.body?.refreshToken;
    const result = await AuthService.refreshToken(token);

    cookieUtils.setAuthCookies(res, result.accessToken, result.refreshToken);

    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Token refreshed successfully",
        data: result,
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

export const AuthController = {
    register,
    login,
    refreshToken,
    logout,
    getMe,
    updateMe,
    changePassword,
};
