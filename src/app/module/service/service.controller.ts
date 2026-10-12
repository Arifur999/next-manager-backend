import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ServiceCategoryService } from "./serviceCategory.service.js";
import { ServiceService } from "./service.service.js";
import { ServiceTemplateService } from "./serviceTemplate.service.js";
import { requireUser } from "../../shared/requireUser.js";
import { idOf } from "../../shared/requestSchemas.js";

// One controller for the three, because they are one screen with three tabs and
// splitting them would be three files of the same eight lines.

const ok = (res: Response, message: string, data: unknown, httpStatus: number = status.OK) =>
    sendResponse(res, { success: true, httpStatus, message, data });

const getServices = catchAsync(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const result = await ServiceService.getAll(requireUser(req), {
        categoryId: typeof query.category_id === "string" ? query.category_id : undefined,
    });
    ok(res, "Services retrieved successfully", result);
});

const getService = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceService.getOne(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Service retrieved successfully",
        data: result,
    });
});

const createService = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceService.create(req.body, requireUser(req));
    ok(res, "Service added successfully", result, status.CREATED);
});

const updateService = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceService.update(
        idOf(req),
        req.body,
        requireUser(req)
    );
    ok(res, "Service updated successfully", result);
});

const deleteService = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceService.remove(idOf(req), requireUser(req));
    ok(res, "Service removed successfully", result);
});

const getRevenue = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceService.getRevenue(requireUser(req));
    ok(res, "Billed by service retrieved successfully", result);
});

const getCategories = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceCategoryService.getAll(requireUser(req));
    ok(res, "Categories retrieved successfully", result);
});

const createCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceCategoryService.create(req.body, requireUser(req));
    ok(res, "Category added successfully", result, status.CREATED);
});

const updateCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceCategoryService.update(
        idOf(req),
        req.body,
        requireUser(req)
    );
    ok(res, "Category updated successfully", result);
});

const deleteCategory = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceCategoryService.remove(
        idOf(req),
        requireUser(req)
    );
    ok(res, result.message, result);
});

const getTemplates = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceTemplateService.getAll(requireUser(req));
    ok(res, "Packages retrieved successfully", result);
});

const createTemplate = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceTemplateService.create(req.body, requireUser(req));
    ok(res, "Package created successfully", result, status.CREATED);
});

const updateTemplate = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceTemplateService.update(
        idOf(req),
        req.body,
        requireUser(req)
    );
    ok(res, "Package updated successfully", result);
});

const deleteTemplate = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceTemplateService.remove(
        idOf(req),
        requireUser(req)
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
