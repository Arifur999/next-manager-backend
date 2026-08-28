import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { KpiService } from "./kpi.service.js";

const getScope = catchAsync(async (req: Request, res: Response) => {
    const options = parseListOptions(req.query as Record<string, unknown>);
    const result = await KpiService.getScope(
        req.params.scope as string,
        req.user as IRequestUser,
        options
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "KPIs retrieved successfully",
        data: result,
    });
});

export const KpiController = { getScope };
