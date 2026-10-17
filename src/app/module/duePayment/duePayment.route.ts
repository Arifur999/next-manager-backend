import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { DuePaymentController } from "./duePayment.controller.js";
import { createDuePersonZodSchema, createDueTransactionZodSchema, dueTransactionListQueryZodSchema, updateDuePersonZodSchema } from "./duePayment.validation.js";
import { idParams } from "../../shared/requestSchemas.js";
import { listQuerySchema } from "../../shared/listQuery.js";

const router = Router();

// Informal lending is the admin's own business.
// /transactions is declared before /:id so the literal path is not swallowed
// by the parameter route.
router.get("/transactions", checkAuth(Role.admin), validateRequest({ query: dueTransactionListQueryZodSchema }), DuePaymentController.getTransactions);
router.post("/transactions", checkAuth(Role.admin), validateRequest(createDueTransactionZodSchema), DuePaymentController.createTransaction);
router.delete("/transactions/:id", checkAuth(Role.admin), validateRequest({ params: idParams }), DuePaymentController.deleteTransaction);

router.get("/", checkAuth(Role.admin), validateRequest({ query: listQuerySchema }), DuePaymentController.getAllPeople);
router.post("/", checkAuth(Role.admin), validateRequest(createDuePersonZodSchema), DuePaymentController.createPerson);
router.patch("/:id", checkAuth(Role.admin), validateRequest({ params: idParams, body: updateDuePersonZodSchema }), DuePaymentController.updatePerson);
router.delete("/:id", checkAuth(Role.admin), validateRequest({ params: idParams }), DuePaymentController.deletePerson);

export const DuePaymentRoutes = router;
