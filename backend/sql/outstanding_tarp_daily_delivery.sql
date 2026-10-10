-- Good2Go daily outstanding tarp email delivery ledger.
-- Not executed by creating this file.
-- One delivery claim per Eastern report date and recipient.

CREATE TABLE IF NOT EXISTS outstanding_tarp_email_deliveries (
    report_date date NOT NULL,
    recipient_key text NOT NULL,
    email text NOT NULL,
    status text NOT NULL CHECK (status IN ('claimed', 'sent', 'failed')),
    provider_response text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (report_date, recipient_key)
);
