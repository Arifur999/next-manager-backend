import { Request, Response } from "express";
import status from "http-status";
import { LoanStatus } from "../../../generated/prisma/enums.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { paginationMeta, parseListOptions } from "../../shared/listQuery.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { LoanService } from "./loan.service.js";
import { ShareholderService } from "./shareholder.service.js";

// ---------------------------------------------------------------- loans

const getAllLoans = catchAsync(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const options = parseListOptions(query);
    const { rows, total } = await LoanService.getAll(req.user as IRequestUser, options, {
        status:
            typeof query.status === "string" && query.status in LoanStatus
                ? (query.status as LoanStatus)
                : undefined,
    });
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Loans retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const getLoan = catchAsync(async (req: Request, res: Response) => {
    const result = await LoanService.getOne(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Loan retrieved successfully",
        data: result,
    });
});

const getLoanSummary = catchAsync(async (req: Request, res: Response) => {
    const result = await LoanService.getSummary(req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Loan summary retrieved successfully",
        data: result,
    });
});

const createLoan = catchAsync(async (req: Request, res: Response) => {
    const result = await LoanService.create(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Loan recorded successfully",
        data: result,
    });
});

const updateLoan = catchAsync(async (req: Request, res: Response) => {
    const result = await LoanService.update(req.params.id as string, req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Loan updated successfully",
        data: result,
    });
});

const setInstalments = catchAsync(async (req: Request, res: Response) => {
    const result = await LoanService.setInstalments(
        req.params.id as string,
        req.body,
        req.user as IRequestUser
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Schedule saved successfully",
        data: result,
    });
});

const payInstalment = catchAsync(async (req: Request, res: Response) => {
    const result = await LoanService.payInstalment(
        req.params.instalmentId as string,
        req.body,
        req.user as IRequestUser
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        // Says what is left rather than just "done": the outstanding figure is
        // the reason anybody opened this screen.
        message: `Instalment paid. ${result.outstanding_bdt.toLocaleString()} BDT still owed.`,
        data: result,
    });
});

const reverseInstalment = catchAsync(async (req: Request, res: Response) => {
    const result = await LoanService.reverseInstalment(
        req.params.instalmentId as string,
        req.user as IRequestUser
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Instalment reversed successfully",
        data: result,
    });
});

const deleteLoan = catchAsync(async (req: Request, res: Response) => {
    const result = await LoanService.remove(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: result.message,
        data: result,
    });
});

// ---------------------------------------------------------------- shareholders

const getAllShareholders = catchAsync(async (req: Request, res: Response) => {
    const result = await ShareholderService.getAll(req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Shareholders retrieved successfully",
        data: result.rows,
        meta: {
            ...paginationMeta({}, result.total),
            allocated_pct: result.allocated_pct,
            unallocated_pct: result.unallocated_pct,
        },
    });
});

const createShareholder = catchAsync(async (req: Request, res: Response) => {
    const result = await ShareholderService.create(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Shareholder added successfully",
        data: result,
    });
});

const updateShareholder = catchAsync(async (req: Request, res: Response) => {
    const result = await ShareholderService.update(
        req.params.id as string,
        req.body,
        req.user as IRequestUser
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Shareholder updated successfully",
        data: result,
    });
});

const deleteShareholder = catchAsync(async (req: Request, res: Response) => {
    const result = await ShareholderService.remove(req.params.id as string, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: result.message,
        data: result,
    });
});

const getDistributions = catchAsync(async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const options = parseListOptions(query);
    const { rows, total } = await ShareholderService.getDistributions(
        req.user as IRequestUser,
        typeof query.shareholder_id === "string" ? query.shareholder_id : undefined,
        options
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Distributions retrieved successfully",
        data: rows,
        meta: paginationMeta(options, total),
    });
});

const createDistribution = catchAsync(async (req: Request, res: Response) => {
    const result = await ShareholderService.createDistribution(req.body, req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Distribution recorded successfully",
        data: result,
    });
});

const deleteDistribution = catchAsync(async (req: Request, res: Response) => {
    const result = await ShareholderService.deleteDistribution(
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

export const LoanController = {
    getAllLoans,
    getLoan,
    getLoanSummary,
    createLoan,
    updateLoan,
    setInstalments,
    payInstalment,
    reverseInstalment,
    deleteLoan,
    getAllShareholders,
    createShareholder,
    updateShareholder,
    deleteShareholder,
    getDistributions,
    createDistribution,
    deleteDistribution,
};
