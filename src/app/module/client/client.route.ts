import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { ClientController } from "./client.controller.js";
import { createClientZodSchema, updateClientZodSchema } from "./client.validation.js";

const router = Router();

// Knowing WHO the agency works for is not sensitive - operations needs it to
// make sense of the project they are on - so the reads are open to everyone
// signed in. What that client is WORTH is a different question, gated below.
router.get("/", checkAuth(), requireCompany, ClientController.getAllClients);
router.get("/:id", checkAuth(), requireCompany, ClientController.getSingleClient);

// Revenue, outstanding and lifetime value are finance, not CRM. Sales owns the
// relationship but not the ledger behind it.
router.get("/:id/financials", checkAuth(Role.admin), ClientController.getClientFinancials);

// Sales owns the client list; admin can act on it too.
router.post("/", checkAuth(Role.admin, Role.sales), requirePermission("clients.manage"), validateRequest(createClientZodSchema), ClientController.createClient);
router.patch("/:id", checkAuth(Role.admin, Role.sales), requirePermission("clients.manage"), validateRequest(updateClientZodSchema), ClientController.updateClient);

// Deleting takes a client out of every report they appear in, so it stays with
// admin even though sales created them.
router.delete("/:id", checkAuth(Role.admin), ClientController.deleteClient);

export const ClientRoutes = router;
