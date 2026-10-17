import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { PermissionService } from "./permission.service.js";
import { paramsOf, queryOf, userIdParams } from "../../shared/requestSchemas.js";
import { requireUser } from "../../shared/requireUser.js";
import { permissionGridQueryZodSchema, userPermissionParams } from "./permission.validation.js";

const getGrid = catchAsync(async (req: Request, res: Response) => {
    const { user_id } = queryOf(req, permissionGridQueryZodSchema);
    const result = await PermissionService.getGrid(requireUser(req), user_id);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Permissions retrieved successfully",
        data: result,
    });
});

const setRolePermission = catchAsync(async (req: Request, res: Response) => {
    const result = await PermissionService.setRolePermission(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Role permission updated",
        data: result,
    });
});

const setUserPermission = catchAsync(async (req: Request, res: Response) => {
    const result = await PermissionService.setUserPermission(
        paramsOf(req, userIdParams).userId,
        req.body,
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Override saved",
        data: result,
    });
});

const clearUserPermission = catchAsync(async (req: Request, res: Response) => {
    // The route validated these against the catalogue, so an unknown segment is
    // a 400 rather than a delete that quietly matches nothing.
    const { userId, module, action } = paramsOf(req, userPermissionParams);

    const result = await PermissionService.clearUserPermission(
        userId,
        module,
        action,
        requireUser(req)
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
