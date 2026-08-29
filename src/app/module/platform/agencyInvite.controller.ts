import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { AgencyInviteService } from "./agencyInvite.service.js";

const createInvite = catchAsync(async (req: Request, res: Response) => {
    const result = await AgencyInviteService.createInvite(req.body, req.user as IRequestUser);

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
    const result = await AgencyInviteService.getInvites();
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Agency invites retrieved successfully",
        data: result,
    });
});

const revokeInvite = catchAsync(async (req: Request, res: Response) => {
    const result = await AgencyInviteService.revokeInvite(
        req.params.id as string,
        req.user as IRequestUser
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Invite revoked successfully",
        data: result,
    });
});

// Public. Whoever opens the link has no account yet.
const getInviteByToken = catchAsync(async (req: Request, res: Response) => {
    const result = await AgencyInviteService.getInviteByToken(req.params.token as string);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Invite retrieved successfully",
        data: result,
    });
});

const acceptInvite = catchAsync(async (req: Request, res: Response) => {
    const result = await AgencyInviteService.acceptInvite(req.params.token as string, req.body);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Your agency is open. Sign in to get started.",
        data: result,
    });
});

export const AgencyInviteController = {
    createInvite,
    getInvites,
    revokeInvite,
    getInviteByToken,
    acceptInvite,
};
