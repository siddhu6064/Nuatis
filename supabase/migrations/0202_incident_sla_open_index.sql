-- Escalation rules can carry a delay ("page the on-call manager 30 minutes
-- after breach"), so the SLA scanner must revisit incidents it has already
-- stamped rather than seeing each one exactly once.
--
-- That makes 0201's partial index useless: it only covered rows with
-- sla_breached_at IS NULL, which is no longer how the scanner queries. The
-- replacement already exists -- 0199's idx_incidents_sla is
-- (sla_due_at) WHERE status NOT IN ('resolved','cancelled'), exactly the new
-- query shape -- so this migration only removes the index nothing reads any
-- more rather than adding a duplicate of one already there.
DROP INDEX IF EXISTS idx_incidents_sla_unbreached;
DROP INDEX IF EXISTS idx_incidents_sla_open;
