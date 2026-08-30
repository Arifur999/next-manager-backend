import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { SecurityService } from "./security.service.js";

const getLoginEvents = catchAsync(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const options = parseListOptions(query);

    const { rows, total, failed_last_24h, retention_days } = await SecurityService.getLoginEvents(
        req.user as IRequestUser,
        options,
        {
            // Only the two real answers. Anything else is ignored rather than
            // refused, so a stale bookmark shows everything.
            success:
                query.success === "true" ? true : query.success === "false" ? false : undefined,
            userId: typeof query.user_id === "string" ? query.user_id : undefined,
        }
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
