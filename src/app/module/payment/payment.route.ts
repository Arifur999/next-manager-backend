import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { PaymentController } from "./payment.controller.js";
import { createPaymentZodSchema, updatePaymentZodSchema } from "./payment.validation.js";
import { idParams } from "../../shared/requestSchemas.js";
import { listQuerySchema } from "../../shared/listQuery.js";

const router = Router();

// Income is admin-only. Sales brings the work in and can raise an invoice,
// but what actually landed in a wallet is a finance question.
router.get("/", checkAuth(Role.admin), validateRequest({ query: listQuerySchema }), PaymentController.getAllPayments);
router.post("/", checkAuth(Role.admin), validateRequest(createPaymentZodSchema), PaymentController.createPayment);
router.patch("/:id", checkAuth(Role.admin), validateRequest({ params: idParams, body: updatePaymentZodSchema }), PaymentController.updatePayment);
router.delete("/:id", checkAuth(Role.admin), validateRequest({ params: idParams }), PaymentController.deletePayment);

export const PaymentRoutes = router;
