import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { UserService } from "./user.service.js";
import { idOf, queryOf } from "../../shared/requestSchemas.js";
import { requireUser } from "../../shared/requireUser.js";
import { userListQueryZodSchema } from "./user.validation.js";

const getAllUsers = catchAsync(async (req: Request, res: Response) => {
    const { status: userStatus, department_id, ...options } = queryOf(req, userListQueryZodSchema);
    const { rows, total } = await UserService.getAllUsers(
        requireUser(req),
        { status: userStatus, departmentId: department_id },
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
    const result = await UserService.getSingleUser(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "User retrieved successfully",
        data: result,
    });
});

const createUser = catchAsync(async (req: Request, res: Response) => {
    const result = await UserService.createUser(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "User created successfully",
        data: result,
    });
});

const updateUser = catchAsync(async (req: Request, res: Response) => {
    const result = await UserService.updateUser(idOf(req), req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "User updated successfully",
        data: result,
    });
});

const deleteUser = catchAsync(async (req: Request, res: Response) => {
    const result = await UserService.deleteUser(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "User deleted successfully",
        data: result,
    });
});

export const UserController = {
    getAllUsers,
    getSingleUser,
    createUser,
    updateUser,
    deleteUser,
};
