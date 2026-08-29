-- `is_active` becomes a three-state `status`.
--
-- A boolean cannot tell "waiting to be let in" apart from "was let in and then
-- removed", and the invite flow needs exactly that distinction. Replacing
-- rather than adding: two fields answering "may this person sign in" disagree
-- the first time one write path forgets the other, and that failure opens
-- access rather than closing it.
--
-- Nobody's access changes on deploy - the mapping is exact both ways.

CREATE TYPE "UserStatus" AS ENUM ('pending', 'active', 'suspended');

ALTER TABLE "users" ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'active';

-- true -> active, false -> suspended. Nobody is pending yet: that state only
-- exists for people who arrive through an invite, and no invite has been sent.
UPDATE "users" SET "status" = 'suspended' WHERE "is_active" = false;

ALTER TABLE "users" DROP COLUMN "is_active";
