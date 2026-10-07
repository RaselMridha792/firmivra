-- Withdrawing a firm file shared with the wrong client (Rasel, Oct 8). Until the app has a
-- button for it, ops run this as the migrate role (the database owner); the app role cannot.
-- One document, by id, with a reason: its links are cleared (a tax return's PDF, a report's
-- attachment, message attachments), the row is deleted and an audit row records why. The file
-- itself is then removed from S3 by hand, with the key the function returns. Steps: R0's file.

-- The one way past the retention rule: a delete by the migrate role (the role running this
-- migration) of the document named in this transaction's app.withdraw_document_id, in that
-- firm's scope. The app role never matches it, whatever it sets.
CREATE POLICY documents_withdraw ON documents FOR DELETE TO CURRENT_USER
  USING (business_id = app_current_business_id()
         AND id::text = current_setting('app.withdraw_document_id', true));

CREATE FUNCTION withdraw_document(p_business_id uuid, p_document_id uuid, p_reason text)
  RETURNS text
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  doc record;
  returns_cleared integer;
  reports_cleared integer;
  attachments_removed integer;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' OR char_length(p_reason) > 500 THEN
    RAISE EXCEPTION 'withdraw_document: give a reason (up to 500 characters)'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('app.scope', 'business', true);
  PERFORM set_config('app.current_business_id', p_business_id::text, true);
  PERFORM set_config('app.withdraw_document_id', p_document_id::text, true);

  SELECT id, client_id, engagement_id, direction, s3_key, legal_hold INTO doc
    FROM documents
   WHERE business_id = p_business_id AND id = p_document_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdraw_document: this firm has no such document'
      USING ERRCODE = 'no_data_found';
  END IF;
  IF doc.legal_hold THEN
    RAISE EXCEPTION 'withdraw_document: the document is under legal hold; clear the hold first'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE tax_returns SET document_id = NULL
   WHERE business_id = p_business_id AND document_id = p_document_id;
  GET DIAGNOSTICS returns_cleared = ROW_COUNT;
  UPDATE engagement_reports SET document_id = NULL
   WHERE business_id = p_business_id AND document_id = p_document_id;
  GET DIAGNOSTICS reports_cleared = ROW_COUNT;
  DELETE FROM message_attachments
   WHERE business_id = p_business_id AND document_id = p_document_id;
  GET DIAGNOSTICS attachments_removed = ROW_COUNT;

  DELETE FROM documents WHERE business_id = p_business_id AND id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdraw_document: the document could not be removed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- No file name or content: the reason, where it was, what was cleared and who ran it.
  INSERT INTO audit_logs (id, business_id, action, entity_type, entity_id, metadata)
  VALUES (gen_random_uuid(), p_business_id, 'document.withdrawn', 'document', p_document_id::text,
          jsonb_build_object(
            'reason', p_reason,
            'clientId', doc.client_id,
            'engagementId', doc.engagement_id,
            'direction', doc.direction,
            'taxReturnsCleared', returns_cleared,
            'reportsCleared', reports_cleared,
            'attachmentsRemoved', attachments_removed,
            'by', session_user));

  PERFORM set_config('app.withdraw_document_id', '', true);
  PERFORM set_config('app.current_business_id', '', true);
  PERFORM set_config('app.scope', '', true);
  RETURN doc.s3_key;
END
$$;

-- Functions are executable by everyone by default: only the owner (the migrate role) runs this.
REVOKE ALL ON FUNCTION withdraw_document(uuid, uuid, text) FROM PUBLIC;
