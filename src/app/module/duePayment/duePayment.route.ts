import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { DuePaymentController } from "./duePayment.controller.js";
import { createDuePersonZodSchema, createDueTransactionZodSchema, updateDuePersonZodSchema } from "./duePayment.validation.js";

const router = Router();

// Informal lending is the owner's own business, so this stops at admin.
// /transactions is declared before /:id so the literal path is not swallowed
// by the parameter route.
router.get("/transactions", checkAuth(Role.owner, Role.admin), DuePaymentController.getTransactions);
router.post("/transactions", checkAuth(Role.owner, Role.admin), validateRequest(createDueTransactionZodSchema), DuePaymentController.createTransaction);
router.delete("/transactions/:id", checkAuth(Role.owner), DuePaymentController.deleteTransaction);

router.get("/", checkAuth(Role.owner, Role.admin), DuePaymentController.getAllPeople);
router.post("/", checkAuth(Role.owner, Role.admin), validateRequest(createDuePersonZodSchema), DuePaymentController.createPerson);
router.patch("/:id", checkAuth(Role.owner, Role.admin), validateRequest(updateDuePersonZodSchema), DuePaymentController.updatePerson);
router.delete("/:id", checkAuth(Role.owner), DuePaymentController.deletePerson);

export const DuePaymentRoutes = router;
