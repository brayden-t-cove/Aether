-- Comments on a design request: questions, updates and revision notes between the requester and the designer,
-- on the request itself instead of in messages.
CREATE TABLE request_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES design_requests(id) ON DELETE CASCADE,
  body        TEXT NOT NULL CHECK (body <> '' AND length(body) <= 5000),
  -- The request's state when the comment was written, e.g. feedback given while it was Delivered.
  state       TEXT NOT NULL CHECK (state IN ('requested', 'in_progress', 'delivered', 'approved', 'cancelled')),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at   TIMESTAMPTZ
);
CREATE INDEX idx_request_comments_request ON request_comments (request_id, created_at);
