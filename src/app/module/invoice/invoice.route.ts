import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { InvoiceController } from "./invoice.controller.js";
import { createInvoiceZodSchema, updateInvoiceZodSchema } from "./invoice.validation.js";

const router = Router();

router.get("/", checkAuth(Role.owner, Role.admin, Role.manager), InvoiceController.getAllInvoices);
router.get("/:id", checkAuth(Role.owner, Role.admin, Role.manager), InvoiceController.getSingleInvoice);
router.post("/", checkAuth(Role.owner, Role.admin, Role.manager), validateRequest(createInvoiceZodSchema), InvoiceController.createInvoice);
router.patch("/:id", checkAuth(Role.owner, Role.admin, Role.manager), validateRequest(updateInvoiceZodSchema), InvoiceController.updateInvoice);
router.delete("/:id", checkAuth(Role.owner, Role.admin), InvoiceController.deleteInvoice);

export const InvoiceRoutes = router;
