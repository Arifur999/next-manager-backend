import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ExpenseCategoryService } from "./expenseCategory.service.js";
import { requireUser } from "../../shared/requireUser.js";
import { idOf } from "../../shared/requestSchemas.js";

const getAllCategories = catchAsync(async (req: Request, res: Response) => {
    const result = await ExpenseCategoryService.getAllCategories(requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Expense categories retrieved successfully",
        data: result,
    });
});

const createCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await ExpenseCategoryService.createCategory(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Expense category created successfully",
        data: result,
    });
});

const updateCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await ExpenseCategoryService.updateCategory(idOf(req), req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Expense category updated successfully",
        data: result,
    });
});

const deleteCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await ExpenseCategoryService.deleteCategory(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Expense category deleted successfully",
        data: result,
    });
});

export const ExpenseCategoryController = {
    getAllCategories,
    createCategory,
    updateCategory,
    deleteCategory,
};
