import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { listQuerySchema } from "../../shared/listQuery.js";
import { idParams } from "../../shared/requestSchemas.js";
import { PlatformFinanceController } from "./platformFinance.controller.js";
import {
    createPlatformExpenseZodSchema,
    platformTrendQueryZodSchema,
    updatePlatformExpenseZodSchema,
} from "./platform.validation.js";

// AGENCIO's own books. Reading the numbers and recording what is spent are
// separate permissions: somebody can be shown how the business is doing
// without being able to change what it says.
// Mounted by PlatformRoutes under /platform.
const router = Router();

router.get(
    "/finance",
    checkAuth(Role.super_admin),
    requirePermission("platform.finance.view"),
    validateRequest({ query: listQuerySchema }),
    PlatformFinanceController.getReport
);
router.get(
    "/trend",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.view"),
    validateRequest({ query: platformTrendQueryZodSchema }),
    PlatformFinanceController.getTrend
);
router.get(
    "/expenses",
    checkAuth(Role.super_admin),
    requirePermission("platform.finance.view", "platform.expenses.manage"),
    validateRequest({ query: listQuerySchema }),
    PlatformFinanceController.getExpenses
);
router.post(
    "/expenses",
    checkAuth(Role.super_admin),
    requirePermission("platform.expenses.manage"),
    validateRequest(createPlatformExpenseZodSchema),
    PlatformFinanceController.createExpense
);
router.patch(
    "/expenses/:id",
    checkAuth(Role.super_admin),
    requirePermission("platform.expenses.manage"),
    validateRequest({ params: idParams, body: updatePlatformExpenseZodSchema }),
    PlatformFinanceController.updateExpense
);
router.delete(
    "/expenses/:id",
    checkAuth(Role.super_admin),
    requirePermission("platform.expenses.manage"),
    validateRequest({ params: idParams }),
    PlatformFinanceController.deleteExpense
);

export const PlatformFinanceRoutes = router;
