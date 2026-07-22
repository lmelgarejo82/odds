CREATE TRIGGER "StatareaCaptureSnapshot_no_update" BEFORE UPDATE ON "StatareaCaptureSnapshot" BEGIN SELECT RAISE(ABORT, 'StatareaCaptureSnapshot is append-only'); END;
CREATE TRIGGER "StatareaCaptureSnapshot_no_delete" BEFORE DELETE ON "StatareaCaptureSnapshot" BEGIN SELECT RAISE(ABORT, 'StatareaCaptureSnapshot is append-only'); END;
CREATE TRIGGER "StatareaRawRow_no_update" BEFORE UPDATE ON "StatareaRawRow" BEGIN SELECT RAISE(ABORT, 'StatareaRawRow is append-only'); END;
CREATE TRIGGER "StatareaRawRow_no_delete" BEFORE DELETE ON "StatareaRawRow" BEGIN SELECT RAISE(ABORT, 'StatareaRawRow is append-only'); END;
CREATE TRIGGER "StatareaRowRejection_no_update" BEFORE UPDATE ON "StatareaRowRejection" BEGIN SELECT RAISE(ABORT, 'StatareaRowRejection is append-only'); END;
CREATE TRIGGER "StatareaRowRejection_no_delete" BEFORE DELETE ON "StatareaRowRejection" BEGIN SELECT RAISE(ABORT, 'StatareaRowRejection is append-only'); END;
CREATE TRIGGER "StatareaCaptureAuditEvent_no_update" BEFORE UPDATE ON "StatareaCaptureAuditEvent" BEGIN SELECT RAISE(ABORT, 'StatareaCaptureAuditEvent is append-only'); END;
CREATE TRIGGER "StatareaCaptureAuditEvent_no_delete" BEFORE DELETE ON "StatareaCaptureAuditEvent" BEGIN SELECT RAISE(ABORT, 'StatareaCaptureAuditEvent is append-only'); END;
