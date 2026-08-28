import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { InvoiceController } from "./invoice.controller.js";
import { createInvoiceZodSchema, updateInvoiceZodSchema } from "./invoice.validation.js";

const router = Router();

// Sales raises invoices - it is the last step of winning the work - but an
// invoice is also a claim on money, so admin sees and edits them too.
router.get("/", checkAuth(Role.admin, Role.sales), InvoiceController.getAllInvoices);
router.get("/:id", checkAuth(Role.admin, Role.sales), InvoiceController.getSingleInvoice);
router.post("/", checkAuth(Role.admin, Role.sales), validateRequest(createInvoiceZodSchema), InvoiceController.createInvoice);
router.patch("/:id", checkAuth(Role.admin, Role.sales), validateRequest(updateInvoiceZodSchema), InvoiceController.updateInvoice);

// Deleting removes a claim from receivables, which is a finance decision.
router.delete("/:id", checkAuth(Role.admin), InvoiceController.deleteInvoice);

export const InvoiceRoutes = router;
