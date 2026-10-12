import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { InviteService } from "./invite.service.js";
import { idOf, paramsOf, tokenParams } from "../../shared/requestSchemas.js";
import { requireUser } from "../../shared/requireUser.js";

const createInvite = catchAsync(async (req: Request, res: Response) => {
    const result = await InviteService.createInvite(req.body, requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        // Says which actually happened. "Send them the link" over a mail that
        // already went makes an admin do a job that is done; the reverse makes
        // them wait for something that is never arriving.
        message: result.email.delivered
            ? `Invite emailed to ${result.invite.email}`
            : "Invite created, but the email could not be sent - copy the link below to them",
        data: result,
    });
});

const getInvites = catchAsync(async (req: Request, res: Response) => {
    const result = await InviteService.getInvites(requireUser(req));
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Invites retrieved successfully",
        data: result,
    });
});

const revokeInvite = catchAsync(async (req: Request, res: Response) => {
    const result = await InviteService.revokeInvite(
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
    const result = await InviteService.getInviteByToken(paramsOf(req, tokenParams).token);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Invite is valid",
        data: result,
    });
});

const acceptInvite = catchAsync(async (req: Request, res: Response) => {
    const result = await InviteService.acceptInvite(paramsOf(req, tokenParams).token, req.body);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Account created. An admin has to approve it before you can sign in.",
        data: result,
    });
});

const approveMember = catchAsync(async (req: Request, res: Response) => {
    const result = await InviteService.approveMember(
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

const rejectMember = catchAsync(async (req: Request, res: Response) => {
    const result = await InviteService.rejectMember(
        idOf(req),
        req.body,
        requireUser(req)
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: result.message,
        data: result,
    });
});

export const InviteController = {
    createInvite,
    getInvites,
    revokeInvite,
    getInviteByToken,
    acceptInvite,
    approveMember,
    rejectMember,
};
