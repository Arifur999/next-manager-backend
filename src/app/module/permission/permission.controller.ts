import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { isAction, isModule } from "../../shared/permissionCatalogue.js";
import AppError from "../../errorHelpers/AppError.js";
import { PermissionService } from "./permission.service.js";

const getGrid = catchAsync(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const result = await PermissionService.getGrid(
        req.user as IRequestUser,
        typeof query.user_id === "string" ? query.user_id : undefined
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Permissions retrieved successfully",
        data: result,
    });
});

const setRolePermission = catchAsync(async (req: Request, res: Response) => {
    const result = await PermissionService.setRolePermission(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Role permission updated",
        data: result,
    });
});

const setUserPermission = catchAsync(async (req: Request, res: Response) => {
    const result = await PermissionService.setUserPermission(
        req.params.userId as string,
        req.body,
        req.user as IRequestUser
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Override saved",
        data: result,
    });
});

const clearUserPermission = catchAsync(async (req: Request, res: Response) => {
    const module = req.params.module as string;
    const action = req.params.action as string;

    // Checked here rather than by a body schema: these arrive in the path, and
    // a path segment the catalogue does not know is a bad request rather than a
    // delete that quietly matches nothing.
    if (!isModule(module) || !isAction(action)) {
        throw new AppError(status.BAD_REQUEST, "Unknown module or action");
    }

    const result = await PermissionService.clearUserPermission(
        req.params.userId as string,
        module,
        action,
        req.user as IRequestUser
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: result.message,
        data: result,
    });
});

export const PermissionController = {
    getGrid,
    setRolePermission,
    setUserPermission,
    clearUserPermission,
};
