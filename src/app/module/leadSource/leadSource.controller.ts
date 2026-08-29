import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { LeadSourceService } from "./leadSource.service.js";

const getAll = catchAsync(async (req: Request, res: Response) => {
    const result = await LeadSourceService.getAll(req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Lead sources retrieved successfully",
        data: result,
    });
});

const create = catchAsync(async (req: Request, res: Response) => {
    const result = await LeadSourceService.create(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Lead source added",
        data: result,
    });
});

const update = catchAsync(async (req: Request, res: Response) => {
    const result = await LeadSourceService.update(
        req.params.id as string,
        req.body,
        req.user as IRequestUser
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Lead source updated",
        data: result,
    });
});

const remove = catchAsync(async (req: Request, res: Response) => {
    const result = await LeadSourceService.remove(
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

export const LeadSourceController = { getAll, create, update, remove };
