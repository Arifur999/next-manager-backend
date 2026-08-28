-- A bill rate per person.
--
-- Utilization answers "how many hours"; realization answers "what were they
-- worth", and there is no way to compute the second from hours alone. Default
-- 0 means unset - the engine reports null realization for anyone on 0 rather
-- than dividing by it, so an unconfigured company gets no number instead of a
-- confident wrong one.
ALTER TABLE "capacities" ADD COLUMN "standard_rate_usd" DECIMAL(10,2) NOT NULL DEFAULT 0;
