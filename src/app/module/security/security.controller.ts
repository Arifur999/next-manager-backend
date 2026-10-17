import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { SecurityService } from "./security.service.js";
import { requireUser } from "../../shared/requireUser.js";
import { queryOf } from "../../shared/requestSchemas.js";
import { loginEventListQueryZodSchema } from "./security.validation.js";

const getLoginEvents = catchAsync(async (req: Request, res: Response) => {
    const { success: outcome, user_id, ...options } = queryOf(req, loginEventListQueryZodSchema);
    const { rows, total, failed_last_24h, retention_days } = await SecurityService.getLoginEvents(
        requireUser(req),
        options,
        { success: outcome, userId: user_id }
    );

    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Login history retrieved successfully",
        data: rows,
        meta: { ...paginationMeta(options, total), failed_last_24h, retention_days },
    });
});

export const SecurityController = { getLoginEvents };
