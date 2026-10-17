import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { VaultService } from "./vault.service.js";
import { idOf, queryOf } from "../../shared/requestSchemas.js";
import { requireUser } from "../../shared/requireUser.js";
import { credentialListQueryZodSchema } from "./vault.validation.js";

// Who and from where, for the access log. Behind a proxy the real client
// address is in X-Forwarded-For, which app.set("trust proxy", 1) makes req.ip
// resolve to correctly.
const accessContext = (req: Request) => ({
    ip: req.ip ?? "",
    userAgent: req.get("user-agent") ?? "",
});

const getAllCredentials = catchAsync(async (req: Request, res: Response) => {
    const { client_id, project_id, ...options } = queryOf(req, credentialListQueryZodSchema);
    const { rows, total } = await VaultService.getAllCredentials(requireUser(req), options, {
        clientId: client_id,
        projectId: project_id,
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
        idOf(req),
        requireUser(req),
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
    const result = await VaultService.getAccessLog(idOf(req), requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Access log retrieved successfully",
        data: result,
    });
});

const createCredential = catchAsync(async (req: Request, res: Response) => {
    const result = await VaultService.createCredential(req.body, requireUser(req), accessContext(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Credential created successfully",
        data: result,
    });
});

const updateCredential = catchAsync(async (req: Request, res: Response) => {
    const result = await VaultService.updateCredential(
        idOf(req),
        req.body,
        requireUser(req),
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
        idOf(req),
        requireUser(req),
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
