-- B002: enforce append-only invariants at the database boundary.
CREATE TRIGGER "SourceArtifact_no_update" BEFORE UPDATE ON "SourceArtifact" BEGIN SELECT RAISE(ABORT, 'SourceArtifact is append-only'); END;
CREATE TRIGGER "SourceArtifact_no_delete" BEFORE DELETE ON "SourceArtifact" BEGIN SELECT RAISE(ABORT, 'SourceArtifact is append-only'); END;
CREATE TRIGGER "ForebetOuSnapshot_no_update" BEFORE UPDATE ON "ForebetOuSnapshot" BEGIN SELECT RAISE(ABORT, 'ForebetOuSnapshot is append-only'); END;
CREATE TRIGGER "ForebetOuSnapshot_no_delete" BEFORE DELETE ON "ForebetOuSnapshot" BEGIN SELECT RAISE(ABORT, 'ForebetOuSnapshot is append-only'); END;
CREATE TRIGGER "StatareaSnapshot_no_update" BEFORE UPDATE ON "StatareaSnapshot" BEGIN SELECT RAISE(ABORT, 'StatareaSnapshot is append-only'); END;
CREATE TRIGGER "StatareaSnapshot_no_delete" BEFORE DELETE ON "StatareaSnapshot" BEGIN SELECT RAISE(ABORT, 'StatareaSnapshot is append-only'); END;
CREATE TRIGGER "MatchResult_no_update" BEFORE UPDATE ON "MatchResult" BEGIN SELECT RAISE(ABORT, 'MatchResult is append-only'); END;
CREATE TRIGGER "MatchResult_no_delete" BEFORE DELETE ON "MatchResult" BEGIN SELECT RAISE(ABORT, 'MatchResult is append-only'); END;
CREATE TRIGGER "ForebetCaptureSnapshot_no_update" BEFORE UPDATE ON "ForebetCaptureSnapshot" BEGIN SELECT RAISE(ABORT, 'ForebetCaptureSnapshot is append-only'); END;
CREATE TRIGGER "ForebetCaptureSnapshot_no_delete" BEFORE DELETE ON "ForebetCaptureSnapshot" BEGIN SELECT RAISE(ABORT, 'ForebetCaptureSnapshot is append-only'); END;
CREATE TRIGGER "ForebetObservation_no_update" BEFORE UPDATE ON "ForebetObservation" BEGIN SELECT RAISE(ABORT, 'ForebetObservation is append-only'); END;
CREATE TRIGGER "ForebetObservation_no_delete" BEFORE DELETE ON "ForebetObservation" BEGIN SELECT RAISE(ABORT, 'ForebetObservation is append-only'); END;
CREATE TRIGGER "ForebetRowRejection_no_update" BEFORE UPDATE ON "ForebetRowRejection" BEGIN SELECT RAISE(ABORT, 'ForebetRowRejection is append-only'); END;
CREATE TRIGGER "ForebetRowRejection_no_delete" BEFORE DELETE ON "ForebetRowRejection" BEGIN SELECT RAISE(ABORT, 'ForebetRowRejection is append-only'); END;
CREATE TRIGGER "ForebetCaptureAuditEvent_no_update" BEFORE UPDATE ON "ForebetCaptureAuditEvent" BEGIN SELECT RAISE(ABORT, 'ForebetCaptureAuditEvent is append-only'); END;
CREATE TRIGGER "ForebetCaptureAuditEvent_no_delete" BEFORE DELETE ON "ForebetCaptureAuditEvent" BEGIN SELECT RAISE(ABORT, 'ForebetCaptureAuditEvent is append-only'); END;
