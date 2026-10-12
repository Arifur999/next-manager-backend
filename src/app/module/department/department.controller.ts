import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { DepartmentService } from "./department.service.js";
import { idOf } from "../../shared/requestSchemas.js";
import { requireUser } from "../../shared/requireUser.js";

const getAll = catchAsync(async (req: Request, res: Response) => {
    const result = await DepartmentService.getAll(requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Departments retrieved successfully",
        data: result,
    });
});

const create = catchAsync(async (req: Request, res: Response) => {
    const result = await DepartmentService.create(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Department created successfully",
        data: result,
    });
});

const update = catchAsync(async (req: Request, res: Response) => {
    const result = await DepartmentService.update(
        idOf(req),
        req.body,
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Department updated successfully",
        data: result,
    });
});

const remove = catchAsync(async (req: Request, res: Response) => {
    const result = await DepartmentService.remove(
        idOf(req),
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Department deleted successfully",
        data: result,
    });
});

export const DepartmentController = { getAll, create, update, remove };
