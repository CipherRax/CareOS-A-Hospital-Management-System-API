-- Admin job / dead-letter inspection (brief §5.9).
--
-- A dead outbox event needs a terminal state that is neither "delivered" nor
-- "still retrying": an administrator who gives up on it needs to say so, and
-- the row must stay so the fact that the event was never delivered remains on
-- the record. A hard delete would hide it.
--
-- DISCARDED is that state. The enum gains a value; no other column changes.

ALTER TYPE "OutboxStatus" ADD VALUE IF NOT EXISTS 'DISCARDED';
