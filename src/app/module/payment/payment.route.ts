import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { PaymentController } from "./payment.controller.js";
import { createPaymentZodSchema, updatePaymentZodSchema } from "./payment.validation.js";

const router = Router();

// Income figures stop at manager - a member has no reason to see what clients
// pay. Only owner and admin can record or change money.
router.get("/", checkAuth(Role.owner, Role.admin, Role.manager), PaymentController.getAllPayments);
router.post("/", checkAuth(Role.owner, Role.admin), validateRequest(createPaymentZodSchema), PaymentController.createPayment);
router.patch("/:id", checkAuth(Role.owner, Role.admin), validateRequest(updatePaymentZodSchema), PaymentController.updatePayment);
router.delete("/:id", checkAuth(Role.owner), PaymentController.deletePayment);

export const PaymentRoutes = router;
