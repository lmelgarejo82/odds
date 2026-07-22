CREATE TRIGGER "MatchRunAttempt_no_update" BEFORE UPDATE ON "MatchRunAttempt" BEGIN SELECT RAISE(ABORT, 'MatchRunAttempt is append-only'); END;
CREATE TRIGGER "MatchRunAttempt_no_delete" BEFORE DELETE ON "MatchRunAttempt" BEGIN SELECT RAISE(ABORT, 'MatchRunAttempt is append-only'); END;
