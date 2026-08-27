import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { AccountService } from "./account.service.js";

const getAllAccounts = catchAsync(async (req: Request, res: Response) => {
    const result = await AccountService.getAllAccounts(req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Accounts retrieved successfully",
        data: result,
    });
});

const getBalanceSummary = catchAsync(async (req: Request, res: Response) => {
    const result = await AccountService.getBalanceSummary(req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Balance summary retrieved successfully",
        data: result,
    });
});

const createAccount = catchAsync(async (req: Request, res: Response) => {
    const result = await AccountService.createAccount(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Account created successfully",
        data: result,
    });
});

const updateAccount = catchAsync(async (req: Request, res: Response) => {
    const result = await AccountService.updateAccount(req.params.id as string, req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Account updated successfully",
        data: result,
    });
});

const deleteAccount = catchAsync(async (req: Request, res: Response) => {
    const result = await AccountService.deleteAccount(req.params.id as string, req.user as IRequestUser);
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
