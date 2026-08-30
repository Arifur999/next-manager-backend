import { Request, Response } from "express";
import status from "http-status";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { NotificationRuleService } from "./notificationRule.service.js";
import { notificationEventParam } from "./notificationRule.validation.js";

const getRules = catchAsync(async (req: Request, res: Response) => {
    const result = await NotificationRuleService.getRules(req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Notification rules retrieved successfully",
        data: result,
    });
});

const setRule = catchAsync(async (req: Request, res: Response) => {
    // Refused rather than silently creating a rule for an event nothing fires.
    const parsed = notificationEventParam.safeParse(req.params.event);

    if (!parsed.success) {
        throw new AppError(status.BAD_REQUEST, "That is not something this app notifies about");
    }

    const result = await NotificationRuleService.setRule(
        parsed.data,
        req.body,
        req.user as IRequestUser
    );

    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Notification rule updated successfully",
        data: result,
    });
});

export const NotificationRuleController = { getRules, setRule };
