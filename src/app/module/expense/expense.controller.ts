import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ExpenseService } from "./expense.service.js";

const getAllExpenses = catchAsync(async (req: Request, res: Response) => {
    const options = parseListOptions(req.query as Record<string, unknown>);
    const { rows, total } = await ExpenseService.getAllExpenses(req.user as IRequestUser, options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Expenses retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const getCategoryBreakdown = catchAsync(async (req: Request, res: Response) => {
    const options = parseListOptions(req.query as Record<string, unknown>);
    const result = await ExpenseService.getCategoryBreakdown(req.user as IRequestUser, options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Expense breakdown retrieved successfully",
        data: result,
    });
});

const createExpense = catchAsync(async (req: Request, res: Response) => {
    const result = await ExpenseService.createExpense(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Expense recorded successfully",
        data: result,
    });
});

const updateExpense = catchAsync(async (req: Request, res: Response) => {
    const result = await ExpenseService.updateExpense(req.params.id as string, req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Expense updated successfully",
        data: result,
    });
});

const deleteExpense = catchAsync(async (req: Request, res: Response) => {
    const result = await ExpenseService.deleteExpense(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Expense deleted successfully",
        data: result,
    });
});

export const ExpenseController = {
    getAllExpenses,
    getCategoryBreakdown,
    createExpense,
    updateExpense,
    deleteExpense,
};
