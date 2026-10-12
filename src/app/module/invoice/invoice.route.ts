import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireScope } from "../../middleware/requireScope.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { InvoiceController } from "./invoice.controller.js";
import { createInvoiceZodSchema, updateInvoiceZodSchema } from "./invoice.validation.js";
import { idParams } from "../../shared/requestSchemas.js";

const router = Router();

// Sales raises invoices - it is the last step of winning the work - but an
// invoice is also a claim on money, so admin sees and edits them too.
router.get("/", checkAuth(Role.admin, Role.sales), InvoiceController.getAllInvoices);
router.get("/:id", checkAuth(Role.admin, Role.sales), validateRequest({ params: idParams }), InvoiceController.getSingleInvoice);
router.post("/", checkAuth(Role.admin, Role.sales), requireScope("invoices", "create"), validateRequest(createInvoiceZodSchema), InvoiceController.createInvoice);
router.patch("/:id", checkAuth(Role.admin, Role.sales), requireScope("invoices", "edit"), validateRequest({ params: idParams, body: updateInvoiceZodSchema }), InvoiceController.updateInvoice);

// Deleting removes a claim from receivables, which is a finance decision.
router.delete("/:id", checkAuth(Role.admin), validateRequest({ params: idParams }), InvoiceController.deleteInvoice);

export const InvoiceRoutes = router;
