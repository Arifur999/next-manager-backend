import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { VaultService } from "./vault.service.js";

// Who and from where, for the access log. Behind a proxy the real client
// address is in X-Forwarded-For, which app.set("trust proxy", 1) makes req.ip
// resolve to correctly.
const accessContext = (req: Request) => ({
    ip: req.ip ?? "",
    userAgent: req.get("user-agent") ?? "",
});

const getAllCredentials = catchAsync(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const options = parseListOptions(query);
    const { rows, total } = await VaultService.getAllCredentials(req.user as IRequestUser, options, {
        clientId: typeof query.client_id === "string" ? query.client_id : undefined,
        projectId: typeof query.project_id === "string" ? query.project_id : undefined,
    });
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Credentials retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const revealCredential = catchAsync(async (req: Request, res: Response) => {
    const result = await VaultService.revealCredential(
        req.params.id as string,
        req.user as IRequestUser,
        accessContext(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Credential revealed",
        data: result,
    });
});

const getAccessLog = catchAsync(async (req: Request, res: Response) => {
    const result = await VaultService.getAccessLog(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Access log retrieved successfully",
        data: result,
    });
});

const createCredential = catchAsync(async (req: Request, res: Response) => {
    const result = await VaultService.createCredential(req.body, req.user as IRequestUser, accessContext(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Credential created successfully",
        data: result,
    });
});

const updateCredential = catchAsync(async (req: Request, res: Response) => {
    const result = await VaultService.updateCredential(
        req.params.id as string,
        req.body,
        req.user as IRequestUser,
        accessContext(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Credential updated successfully",
        data: result,
    });
});

const deleteCredential = catchAsync(async (req: Request, res: Response) => {
    const result = await VaultService.deleteCredential(
        req.params.id as string,
        req.user as IRequestUser,
        accessContext(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Credential deleted successfully",
        data: result,
    });
});

export const VaultController = {
    getAllCredentials,
    revealCredential,
    getAccessLog,
    createCredential,
    updateCredential,
    deleteCredential,
};
