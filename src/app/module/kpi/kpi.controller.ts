import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { listQuerySchema } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { KpiService } from "./kpi.service.js";
import { paramsOf, queryOf } from "../../shared/requestSchemas.js";
import { requireUser } from "../../shared/requireUser.js";
import { kpiScopeParams } from "./kpi.validation.js";

const getScope = catchAsync(async (req: Request, res: Response) => {
    const options = queryOf(req, listQuerySchema);
    const result = await KpiService.getScope(
        paramsOf(req, kpiScopeParams).scope,
        requireUser(req),
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
