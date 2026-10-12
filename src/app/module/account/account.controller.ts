import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { AccountService } from "./account.service.js";
import { requireUser } from "../../shared/requireUser.js";
import { idOf } from "../../shared/requestSchemas.js";

const getAllAccounts = catchAsync(async (req: Request, res: Response) => {
    const result = await AccountService.getAllAccounts(requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Accounts retrieved successfully",
        data: result,
    });
});

const getBalanceSummary = catchAsync(async (req: Request, res: Response) => {
    const result = await AccountService.getBalanceSummary(requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Balance summary retrieved successfully",
        data: result,
    });
});

const createAccount = catchAsync(async (req: Request, res: Response) => {
    const result = await AccountService.createAccount(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Account created successfully",
        data: result,
    });
});

const updateAccount = catchAsync(async (req: Request, res: Response) => {
    const result = await AccountService.updateAccount(idOf(req), req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Account updated successfully",
        data: result,
    });
});

const deleteAccount = catchAsync(async (req: Request, res: Response) => {
    const result = await AccountService.deleteAccount(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Account deleted successfully",
        data: result,
    });
});

export const AccountController = {
    getAllAccounts,
    getBalanceSummary,
    createAccount,
    updateAccount,
    deleteAccount,
};
