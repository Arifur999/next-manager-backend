import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { ClientController } from "./client.controller.js";
import { createClientZodSchema, updateClientZodSchema } from "./client.validation.js";

const router = Router();

router.get("/", checkAuth(), ClientController.getAllClients);
router.get("/:id", checkAuth(), ClientController.getSingleClient);
// Revenue and lifetime value are figures a member should not see.
router.get("/:id/financials", checkAuth(Role.owner, Role.admin, Role.manager), ClientController.getClientFinancials);
router.post("/", checkAuth(Role.owner, Role.admin, Role.manager), validateRequest(createClientZodSchema), ClientController.createClient);
router.patch("/:id", checkAuth(Role.owner, Role.admin, Role.manager), validateRequest(updateClientZodSchema), ClientController.updateClient);
router.delete("/:id", checkAuth(Role.owner, Role.admin), ClientController.deleteClient);

export const ClientRoutes = router;
