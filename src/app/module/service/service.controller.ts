import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ServiceCategoryService } from "./serviceCategory.service.js";
import { ServiceService } from "./service.service.js";
import { ServiceTemplateService } from "./serviceTemplate.service.js";

// One controller for the three, because they are one screen with three tabs and
// splitting them would be three files of the same eight lines.

const ok = (res: Response, message: string, data: unknown, httpStatus: number = status.OK) =>
    sendResponse(res, { success: true, httpStatus, message, data });

const getServices = catchAsync(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const result = await ServiceService.getAll(req.user as IRequestUser, {
        categoryId: typeof query.category_id === "string" ? query.category_id : undefined,
    });
    ok(res, "Services retrieved successfully", result);
});

const getService = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceService.getOne(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Service retrieved successfully",
        data: result,
    });
});

const createService = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceService.create(req.body, req.user as IRequestUser);
    ok(res, "Service added successfully", result, status.CREATED);
});

const updateService = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceService.update(
        req.params.id as string,
        req.body,
        req.user as IRequestUser
    );
    ok(res, "Service updated successfully", result);
});

const deleteService = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceService.remove(req.params.id as string, req.user as IRequestUser);
    ok(res, "Service removed successfully", result);
});

const getRevenue = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceService.getRevenue(req.user as IRequestUser);
    ok(res, "Billed by service retrieved successfully", result);
});

const getCategories = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceCategoryService.getAll(req.user as IRequestUser);
    ok(res, "Categories retrieved successfully", result);
});

const createCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceCategoryService.create(req.body, req.user as IRequestUser);
    ok(res, "Category added successfully", result, status.CREATED);
});

const updateCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceCategoryService.update(
        req.params.id as string,
        req.body,
        req.user as IRequestUser
    );
    ok(res, "Category updated successfully", result);
});

const deleteCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceCategoryService.remove(
        req.params.id as string,
        req.user as IRequestUser
    );
    ok(res, result.message, result);
});

const getTemplates = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceTemplateService.getAll(req.user as IRequestUser);
    ok(res, "Packages retrieved successfully", result);
});

const createTemplate = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceTemplateService.create(req.body, req.user as IRequestUser);
    ok(res, "Package created successfully", result, status.CREATED);
});

const updateTemplate = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceTemplateService.update(
        req.params.id as string,
        req.body,
        req.user as IRequestUser
    );
    ok(res, "Package updated successfully", result);
});

const deleteTemplate = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceTemplateService.remove(
        req.params.id as string,
        req.user as IRequestUser
    );
    ok(res, "Package removed successfully", result);
});

export const ServiceController = {
    getService,
    getServices,
    createService,
    updateService,
    deleteService,
    getRevenue,
    getCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    getTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
};
