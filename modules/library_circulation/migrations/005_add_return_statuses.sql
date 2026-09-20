-- 005_add_return_statuses.sql
--
-- Feature D18: Return Form — Information & Status
-- Adds support for detailed return status tracking (damaged, other)
-- and optional notes field for return circumstances.

ALTER TABLE library_borrowings
ADD COLUMN return_status TEXT,
ADD COLUMN return_notes TEXT;

-- Create a CHECK constraint for valid return statuses
-- Note: Using raw SQL constraint since Prisma doesn't support constraint names
-- Valid statuses: returned (on time), overdue (late but returned), damaged, lost, other
ALTER TABLE library_borrowings
ADD CONSTRAINT valid_return_status CHECK (
  return_status IS NULL OR
  return_status IN ('returned', 'damaged', 'lost', 'other')
);
