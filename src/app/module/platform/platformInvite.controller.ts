import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { PlatformInviteService } from "./platformInvite.service.js";
import { idOf, paramsOf, tokenParams } from "../../shared/requestSchemas.js";
import { requireUser } from "../../shared/requireUser.js";

const createInvite = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformInviteService.createInvite(req.body, requireUser(req));

    // Says which actually happened. "Send them the link" when the mail went out
    // makes the operator do a job already done; "emailed" when it did not makes
    // them wait for something that is never arriving.
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: result.email.delivered
            ? `Invite emailed to ${result.invite.email}`
            : "Invite created, but the email could not be sent - copy the link below to them",
        data: result,
    });
});

const getInvites = catchAsync(async (_req: Request, res: Response) => {
    const result = await PlatformInviteService.getInvites();
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Invites retrieved successfully",
        data: result,
    });
});

const revokeInvite = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformInviteService.revokeInvite(
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

const getInviteByToken = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformInviteService.getInviteByToken(paramsOf(req, tokenParams).token);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Invite is valid",
        data: result,
    });
});

const acceptInvite = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformInviteService.acceptInvite(paramsOf(req, tokenParams).token, req.body);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Account created. An existing operator has to approve it before you can sign in.",
        data: result,
    });
});

const approveAdmin = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformInviteService.approveAdmin(
        idOf(req),
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Approved",
        data: result,
    });
});

const removeAdmin = catchAsync(async (req: Request, res: Response) => {
    const result = await PlatformInviteService.removeAdmin(
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

export const PlatformInviteController = {
    createInvite,
    getInvites,
    revokeInvite,
    getInviteByToken,
    acceptInvite,
    approveAdmin,
    removeAdmin,
};
