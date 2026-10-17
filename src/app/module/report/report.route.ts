import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { ReportController } from "./report.controller.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { listQuerySchema } from "../../shared/listQuery.js";
import { clientRevenueQueryZodSchema, monthlySeriesQueryZodSchema } from "./report.validation.js";

const router = Router();

// Reports aggregate the whole agency's money, so they stop at admin. All of
// them accept ?from= and ?to= as YYYY-MM-DD.
router.get("/profit-loss", checkAuth(Role.admin), validateRequest({ query: listQuerySchema }), ReportController.getProfitAndLoss);
router.get("/cash-flow", checkAuth(Role.admin), validateRequest({ query: listQuerySchema }), ReportController.getCashFlow);
// Sales reaches this one, and only ever in its scoped form - the controller
// forces `mine` for them rather than reading it from the query.
router.get("/client-revenue", checkAuth(Role.admin, Role.sales), validateRequest({ query: clientRevenueQueryZodSchema }), ReportController.getClientRevenue);
// The project manager runs delivery, so what a project costs and earns is
// their business - unlike a salesperson, who gets their own clients only.
router.get(
    "/project-profitability",
    checkAuth(Role.admin, Role.project_manager),
    validateRequest({ query: listQuerySchema }),
    ReportController.getProjectProfitability
);
router.get("/monthly", checkAuth(Role.admin), validateRequest({ query: monthlySeriesQueryZodSchema }), ReportController.getMonthlySeries);

export const ReportRoutes = router;
