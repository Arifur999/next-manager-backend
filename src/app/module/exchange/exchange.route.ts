import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { ExchangeController } from "./exchange.controller.js";
import { createExchangeZodSchema } from "./exchange.validation.js";

const router = Router();

// There is no update route on purpose. An exchange writes two balancing ledger
// rows; editing it in place would mean unpicking both, and the honest record of
// "we exchanged at the wrong rate, then corrected it" is a reversal plus a new
// entry - which is exactly delete-then-create.
router.get("/", checkAuth(Role.admin), ExchangeController.getAllExchanges);
router.post("/", checkAuth(Role.admin), validateRequest(createExchangeZodSchema), ExchangeController.createExchange);
router.delete("/:id", checkAuth(Role.admin), ExchangeController.deleteExchange);

export const ExchangeRoutes = router;
