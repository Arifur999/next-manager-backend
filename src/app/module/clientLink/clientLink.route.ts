import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { ClientLinkController } from "./clientLink.controller.js";
import {
    createClientLinkZodSchema,
    updateClientLinkZodSchema,
} from "./clientLink.validation.js";

const router = Router();

// Readable by everyone signed in - operations needs to open the Figma file it
// is working from. The service scopes it to the clients they are actually on,
// so "everyone" means everyone's own clients.
router.get("/", checkAuth(), requireCompany, ClientLinkController.getAll);

// Sales keeps a client's material together, and delivery adds what it sets up
// along the way. Operations reads but does not curate.
router.post(
    "/",
    checkAuth(Role.admin, Role.sales, Role.project_manager),
    validateRequest(createClientLinkZodSchema),
    ClientLinkController.create
);
router.patch(
    "/:id",
    checkAuth(Role.admin, Role.sales, Role.project_manager),
    validateRequest(updateClientLinkZodSchema),
    ClientLinkController.update
);
router.delete(
    "/:id",
    checkAuth(Role.admin, Role.sales, Role.project_manager),
    ClientLinkController.remove
);

export const ClientLinkRoutes = router;
