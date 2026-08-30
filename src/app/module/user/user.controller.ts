import { Request, Response } from "express";
import status from "http-status";
import { UserStatus } from "../../../generated/prisma/enums.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { UserService } from "./user.service.js";

const parseFilters = (query: Record<string, unknown>) => ({
    status:
        typeof query.status === "string" && query.status in UserStatus
            ? (query.status as UserStatus)
            : undefined,
    departmentId: typeof query.department_id === "string" ? query.department_id : undefined,
});

const getAllUsers = catchAsync(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const options = parseListOptions(query);
    const { rows, total } = await UserService.getAllUsers(
        req.user as IRequestUser,
        parseFilters(query),
        options
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Users retrieved successfully",
        // `data` stays a plain array whether or not paging was asked for, so a
        // caller that ignores `meta` sees exactly what it saw before.
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const getSingleUser = catchAsync(async (req: Request, res: Response) => {
    const result = await UserService.getSingleUser(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "User retrieved successfully",
        data: result,
    });
});

const createUser = catchAsync(async (req: Request, res: Response) => {
    const result = await UserService.createUser(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "User created successfully",
        data: result,
    });
});

const updateUser = catchAsync(async (req: Request, res: Response) => {
    const result = await UserService.updateUser(req.params.id as string, req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "User updated successfully",
        data: result,
    });
});

const deleteUser = catchAsync(async (req: Request, res: Response) => {
    const result = await UserService.deleteUser(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "User deleted successfully",
        data: result,
    });
});

const setPermissions = catchAsync(async (req: Request, res: Response) => {
    const result = await UserService.setPermissions(
        req.params.id as string,
        req.body,
        req.user as IRequestUser
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Access updated successfully",
        data: result,
    });
});

export const UserController = {
    getAllUsers,
    getSingleUser,
    createUser,
    updateUser,
    deleteUser,
    setPermissions,
};
