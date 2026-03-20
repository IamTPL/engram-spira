-- Persist user dismissals so AI suggestions don't reappear
CREATE TABLE IF NOT EXISTS dismissed_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  target_card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_card_id, target_card_id)
);

CREATE INDEX idx_dismissed_suggestions_user ON dismissed_suggestions(user_id);
