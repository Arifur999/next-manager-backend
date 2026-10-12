import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { LoanController } from "./loan.controller.js";
import {
    createDistributionZodSchema,
    createLoanZodSchema,
    createShareholderZodSchema,
    payInstalmentZodSchema,
    setInstalmentsZodSchema,
    updateLoanZodSchema,
    updateShareholderZodSchema,
} from "./loan.validation.js";
import { instalmentIdParams, idParams } from "../../shared/requestSchemas.js";

const router = Router();

// Admin alone, all of it.
//
// What the agency owes a bank and who owns the business are the two facts a
// company keeps furthest from its staff, and a distribution moves money out of
// a real account. There is no wider role that has any use for these screens.
const admin = [checkAuth(Role.admin), requireCompany] as const;

// ---------------------------------------------------------------- loans
//
// The literal paths are declared before /:id so the parameter route does not
// swallow them.
router.get("/summary", ...admin, LoanController.getLoanSummary);

router.get("/", ...admin, LoanController.getAllLoans);
router.post("/", ...admin, validateRequest(createLoanZodSchema), LoanController.createLoan);

router.patch(
    "/instalments/:instalmentId/pay",
    ...admin,
    validateRequest({ params: instalmentIdParams, body: payInstalmentZodSchema }),
    LoanController.payInstalment
);
// Undoing a repayment recorded by mistake. Writes an opposite ledger row rather
// than deleting one, so the history stays true.
router.patch("/instalments/:instalmentId/reverse", ...admin, validateRequest({ params: instalmentIdParams }), LoanController.reverseInstalment);

router.get("/:id", ...admin, validateRequest({ params: idParams }), LoanController.getLoan);
router.patch("/:id", ...admin, validateRequest({ params: idParams, body: updateLoanZodSchema }), LoanController.updateLoan);
router.patch(
    "/:id/instalments",
    ...admin,
    validateRequest({ params: idParams, body: setInstalmentsZodSchema }),
    LoanController.setInstalments
);
router.delete("/:id", ...admin, validateRequest({ params: idParams }), LoanController.deleteLoan);

export const LoanRoutes = router;

// ---------------------------------------------------------------- shareholders

const shareholderRouter = Router();

shareholderRouter.get("/distributions", ...admin, LoanController.getDistributions);
shareholderRouter.post(
    "/distributions",
    ...admin,
    validateRequest(createDistributionZodSchema),
    LoanController.createDistribution
);
shareholderRouter.delete("/distributions/:id", ...admin, validateRequest({ params: idParams }), LoanController.deleteDistribution);

shareholderRouter.get("/", ...admin, LoanController.getAllShareholders);
shareholderRouter.post(
    "/",
    ...admin,
    validateRequest(createShareholderZodSchema),
    LoanController.createShareholder
);
shareholderRouter.patch(
    "/:id",
    ...admin,
    validateRequest({ params: idParams, body: updateShareholderZodSchema }),
    LoanController.updateShareholder
);
shareholderRouter.delete("/:id", ...admin, validateRequest({ params: idParams }), LoanController.deleteShareholder);

export const ShareholderRoutes = shareholderRouter;
