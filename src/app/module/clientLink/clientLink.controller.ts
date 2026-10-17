import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ClientLinkService } from "./clientLink.service.js";
import { requireUser } from "../../shared/requireUser.js";
import { idOf, queryOf } from "../../shared/requestSchemas.js";
import { clientLinkListQueryZodSchema } from "./clientLink.validation.js";

const getAll = catchAsync(async (req: Request, res: Response) => {
    const { client_id } = queryOf(req, clientLinkListQueryZodSchema);
    const result = await ClientLinkService.getAll(requireUser(req), { clientId: client_id });
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Links retrieved successfully",
        data: result,
    });
});

const create = catchAsync(async (req: Request, res: Response) => {
    const result = await ClientLinkService.create(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Link added",
        data: result,
    });
});

const update = catchAsync(async (req: Request, res: Response) => {
    const result = await ClientLinkService.update(
        idOf(req),
        req.body,
        requireUser(req)
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
        idOf(req),
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: result.message,
        data: result,
    });
});

export const ClientLinkController = { getAll, create, update, remove };
