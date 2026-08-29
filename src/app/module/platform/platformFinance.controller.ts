import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { PlatformFinanceService } from "./platformFinance.service.js";

const range = (query: Record<string, unknown>) => ({
    from: typeof query.from === "string" ? query.from : undefined,
    to: typeof query.to === "string" ? query.to : undefined,
});

const getReport = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformFinanceService.getReport(range(req.query as Record<string, unknown>));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Financial report retrieved successfully",
        data: result,
    });
});

const getExpenses = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformFinanceService.getExpenses(
        range(req.query as Record<string, unknown>)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Expenses retrieved successfully",
        data: result,
    });
});

const createExpense = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformFinanceService.createExpense(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Expense recorded",
        data: result,
    });
});

const updateExpense = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformFinanceService.updateExpense(
        req.params.id as string,
        req.body,
        req.user as IRequestUser
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Expense updated",
        data: result,
    });
});

const deleteExpense = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformFinanceService.deleteExpense(
        req.params.id as string,
        req.user as IRequestUser
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: result.message,
        data: result,
    });
});

const getTrend = catchAsync(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const result = await PlatformFinanceService.getTrend(
        typeof query.days === "string" ? Number(query.days) || 90 : 90
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Trend retrieved successfully",
        data: result,
    });
});

export const PlatformFinanceController = {
    getReport,
    getTrend,
    getExpenses,
    createExpense,
    updateExpense,
    deleteExpense,
};
