-- "Review" joins the default project board.
--
-- Work that is done but not signed off. Category is `active`, not `done`: it is
-- not finished, and everywhere this codebase reasons about category rather than
-- name -- open-project counts, completed_at, board ordering -- a Review reading
-- as `done` would quietly close projects nobody had accepted.
--
-- ONLY agencies whose project board is still exactly the seeded five are
-- touched. An agency that has renamed, removed or added a status has an opinion
-- about its own board, and inserting into it would overwrite that opinion. The
-- guard is the whole point of this migration, so it is written as a match on
-- the exact set rather than a count.

WITH stock AS (
    SELECT ws."organization_id"
    FROM "workflow_statuses" ws
    WHERE ws."kind" = 'project'
    GROUP BY ws."organization_id"
    HAVING array_agg(ws."name" ORDER BY ws."name") =
           ARRAY['Active', 'Cancelled', 'Completed', 'On hold', 'Planning']
)
INSERT INTO "workflow_statuses"
    ("id", "organization_id", "kind", "name", "category", "sort_order", "is_default", "is_active", "created_at", "updated_at")
SELECT
    gen_random_uuid()::text,
    stock."organization_id",
    'project',
    'Review',
    'active',
    2,
    false,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM stock;

-- The three that sit after it move down, so the board reads in the order the
-- seed now describes. Same guard: only boards that just received a Review.
UPDATE "workflow_statuses" ws
SET "sort_order" = ws."sort_order" + 1
WHERE ws."kind" = 'project'
  AND ws."name" IN ('On hold', 'Completed', 'Cancelled')
  AND ws."sort_order" >= 2
  AND EXISTS (
      SELECT 1 FROM "workflow_statuses" r
      WHERE r."organization_id" = ws."organization_id"
        AND r."kind" = 'project'
        AND r."name" = 'Review'
        AND r."sort_order" = 2
  );
