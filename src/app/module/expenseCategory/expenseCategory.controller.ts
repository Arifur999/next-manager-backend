import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ExpenseCategoryService } from "./expenseCategory.service.js";

const getAllCategories = catchAsync(async (req: Request, res: Response) => {
    const result = await ExpenseCategoryService.getAllCategories(req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Expense categories retrieved successfully",
        data: result,
    });
});

const createCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await ExpenseCategoryService.createCategory(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Expense category created successfully",
        data: result,
    });
});

const updateCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await ExpenseCategoryService.updateCategory(req.params.id as string, req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Expense category updated successfully",
        data: result,
    });
});

const deleteCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await ExpenseCategoryService.deleteCategory(req.params.id as string, req.user as IRequestUser);
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
