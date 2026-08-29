import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ClientLinkService } from "./clientLink.service.js";

const getAll = catchAsync(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const result = await ClientLinkService.getAll(req.user as IRequestUser, {
        clientId: typeof query.client_id === "string" ? query.client_id : undefined,
    });
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Links retrieved successfully",
        data: result,
    });
});

const create = catchAsync(async (req: Request, res: Response) => {
    const result = await ClientLinkService.create(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Link added",
        data: result,
    });
});

const update = catchAsync(async (req: Request, res: Response) => {
    const result = await ClientLinkService.update(
        req.params.id as string,
        req.body,
        req.user as IRequestUser
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Link updated",
        data: result,
    });
});

const remove = catchAsync(async (req: Request, res: Response) => {
    const result = await ClientLinkService.remove(
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

export const ClientLinkController = { getAll, create, update, remove };
