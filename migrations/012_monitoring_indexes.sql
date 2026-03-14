-- Performance indexes for trust-score and monitoring queries
CREATE INDEX IF NOT EXISTS idx_monitoring_checks_endpoint_checked
    ON monitoring_checks (endpoint, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_daily_checks_endpoint_checked
    ON daily_checks (endpoint, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_services_owner_address
    ON services (owner_address);

CREATE INDEX IF NOT EXISTS idx_services_status
    ON services (status);
