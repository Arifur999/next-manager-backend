import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { DepartmentService } from "./department.service.js";

const getAll = catchAsync(async (req: Request, res: Response) => {
    const result = await DepartmentService.getAll(req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Departments retrieved successfully",
        data: result,
    });
});

const create = catchAsync(async (req: Request, res: Response) => {
    const result = await DepartmentService.create(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Department created successfully",
        data: result,
    });
});

const update = catchAsync(async (req: Request, res: Response) => {
    const result = await DepartmentService.update(
        req.params.id as string,
        req.body,
        req.user as IRequestUser
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
        req.params.id as string,
        req.user as IRequestUser
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Department deleted successfully",
        data: result,
    });
});

export const DepartmentController = { getAll, create, update, remove };
