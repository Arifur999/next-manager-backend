import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { InviteService } from "./invite.service.js";

const createInvite = catchAsync(async (req: Request, res: Response) => {
    const result = await InviteService.createInvite(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Invite created. Send them the link.",
        data: result,
    });
});

const getInvites = catchAsync(async (req: Request, res: Response) => {
    const result = await InviteService.getInvites(req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Invites retrieved successfully",
        data: result,
    });
});

const revokeInvite = catchAsync(async (req: Request, res: Response) => {
    const result = await InviteService.revokeInvite(
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

const getInviteByToken = catchAsync(async (req: Request, res: Response) => {
    const result = await InviteService.getInviteByToken(req.params.token as string);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Invite is valid",
        data: result,
    });
});

const acceptInvite = catchAsync(async (req: Request, res: Response) => {
    const result = await InviteService.acceptInvite(req.params.token as string, req.body);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Account created. An admin has to approve it before you can sign in.",
        data: result,
    });
});

const approveMember = catchAsync(async (req: Request, res: Response) => {
    const result = await InviteService.approveMember(
        req.params.id as string,
        req.user as IRequestUser
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
        req.params.id as string,
        req.body,
        req.user as IRequestUser
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
