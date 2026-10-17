import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { listQuerySchema, paginationMeta } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ExpenseService } from "./expense.service.js";
import { requireUser } from "../../shared/requireUser.js";
import { idOf, queryOf } from "../../shared/requestSchemas.js";

const getAllExpenses = catchAsync(async (req: Request, res: Response) => {
    const options = queryOf(req, listQuerySchema);
    const { rows, total } = await ExpenseService.getAllExpenses(requireUser(req), options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Expenses retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const getCategoryBreakdown = catchAsync(async (req: Request, res: Response) => {
    const options = queryOf(req, listQuerySchema);
    const result = await ExpenseService.getCategoryBreakdown(requireUser(req), options);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Expense breakdown retrieved successfully",
        data: result,
    });
});

const createExpense = catchAsync(async (req: Request, res: Response) => {
    const result = await ExpenseService.createExpense(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Expense recorded successfully",
        data: result,
    });
});

const updateExpense = catchAsync(async (req: Request, res: Response) => {
    const result = await ExpenseService.updateExpense(idOf(req), req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Expense updated successfully",
        data: result,
    });
});

const deleteExpense = catchAsync(async (req: Request, res: Response) => {
    const result = await ExpenseService.deleteExpense(idOf(req), requireUser(req));
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
