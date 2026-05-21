-- 0116_campaign_performance_view.sql
-- P13 AI Campaigns: aggregated delivery metrics per campaign per channel.
-- No RLS on the view — underlying campaign_sends table enforces tenant isolation.

CREATE OR REPLACE VIEW campaign_performance AS
  SELECT
    campaign_id,
    channel,
    count(*)                                              AS total_sent,
    count(*) FILTER (WHERE status = 'delivered')          AS delivered,
    count(*) FILTER (WHERE status = 'opened')             AS opened,
    count(*) FILTER (WHERE status = 'clicked')            AS clicked,
    count(*) FILTER (WHERE status = 'opted_out')          AS opted_out,
    count(*) FILTER (WHERE status = 'failed')             AS failed
  FROM campaign_sends
  GROUP BY campaign_id, channel;
