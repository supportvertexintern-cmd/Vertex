-- Column allowlist for vertex_readonly (the pgAdmin role).
--
-- Every column in the schema must be classified here as 'grant' or
-- 'exclude'; tests/test_db_roles.py fails CI on any unclassified column, so a
-- migration that adds a column must add its row here (default: exclude).
-- Only 'grant' rows become readable. deploy.sh and the tests load this file
-- before db-roles.sql, which applies it.
--
-- Bootstrap classification (2026-10-09), conservative: identifiers, links,
-- statuses, flags, business timestamps, amounts and public reference data
-- are granted; secrets, the audit log, and any free text, JSON or personal
-- attribute about people or businesses are excluded. REVIEW before relying
-- on it; change a decision by editing its row.

DROP TABLE IF EXISTS pg_temp.readonly_columns;
CREATE TEMP TABLE readonly_columns (tbl text, col text, decision text CHECK (decision IN ('grant', 'exclude')));
INSERT INTO readonly_columns (tbl, col, decision) VALUES
  ('Application', 'id',                                     'grant'),   -- identifier/link
  ('Application', 'candidate_id',                           'grant'),   -- identifier/link
  ('Application', 'job_id',                                 'grant'),   -- identifier/link
  ('Application', 'application_status',                     'grant'),   -- status/type value
  ('Application', 'cover_letter',                           'exclude'), -- free text/JSON: may hold personal data
  ('Application', 'internal_notes',                         'exclude'), -- free text/JSON: may hold personal data
  ('Application', 'interview_date',                         'grant'),   -- business timestamp
  ('Application', 'submitted_at',                           'grant'),   -- business timestamp
  ('Application', 'updated_at',                             'grant'),   -- business timestamp
  ('Application', 'preferred_country_1_id',                 'grant'),   -- identifier/link
  ('Application', 'preferred_country_2_id',                 'grant'),   -- identifier/link
  ('Application', 'preferred_country_3_id',                 'grant'),   -- identifier/link
  ('Application', 'preferred_sector_id',                    'grant'),   -- identifier/link
  ('Application', 'earliest_travel_date',                   'grant'),   -- business timestamp
  ('Application', 'prior_eu_visa_applied',                  'grant'),   -- flag
  ('Application', 'prior_eu_visa_applied_details',          'exclude'), -- free text/JSON: may hold personal data
  ('Application', 'documents_available',                    'exclude'), -- free text/JSON: may hold personal data
  ('Application', 'current_location_country_name',          'exclude'), -- personal data
  ('Application', 'current_location_country_id',            'grant'),   -- identifier/link
  ('Application', 'holds_schengen_visa',                    'grant'),   -- flag
  ('Application', 'holds_schengen_visa_details',            'exclude'), -- free text/JSON: may hold personal data
  ('Application', 'prior_visa_refusals',                    'grant'),   -- flag
  ('Application', 'prior_visa_refusals_details',            'exclude'), -- free text/JSON: may hold personal data
  ('Application', 'available_for_embassy_appointment',      'grant'),   -- flag
  ('Application', 'willing_to_start_within_30_days',        'grant'),   -- flag
  ('Application', 'preferred_contact_channel',              'grant'),   -- status/type value
  ('Application', 'payment_plan_acknowledged',              'grant'),   -- flag
  ('Application', 'job_position_id',                        'grant'),   -- identifier/link
  ('AuditLog', 'id',                                        'exclude'), -- audit log holds personal-data snapshots
  ('AuditLog', 'entity_type',                               'exclude'), -- audit log holds personal-data snapshots
  ('AuditLog', 'entity_id',                                 'exclude'), -- audit log holds personal-data snapshots
  ('AuditLog', 'action',                                    'exclude'), -- audit log holds personal-data snapshots
  ('AuditLog', 'actor_id',                                  'exclude'), -- audit log holds personal-data snapshots
  ('AuditLog', 'before',                                    'exclude'), -- audit log holds personal-data snapshots
  ('AuditLog', 'after',                                     'exclude'), -- audit log holds personal-data snapshots
  ('AuditLog', 'created_at',                                'exclude'), -- audit log holds personal-data snapshots
  ('Campaign', 'id',                                        'grant'),   -- identifier/link
  ('Campaign', 'name',                                      'exclude'), -- personal data
  ('Campaign', 'criteria',                                  'exclude'), -- free text/JSON: may hold personal data
  ('Campaign', 'status',                                    'grant'),   -- status/type value
  ('Campaign', 'created_by',                                'exclude'), -- free text/JSON: may hold personal data
  ('Campaign', 'start_date',                                'grant'),   -- business timestamp
  ('Campaign', 'end_date',                                  'grant'),   -- business timestamp
  ('Campaign', 'created_at',                                'grant'),   -- business timestamp
  ('Campaign', 'updated_at',                                'grant'),   -- business timestamp
  ('CampaignTarget', 'id',                                  'grant'),   -- identifier/link
  ('CampaignTarget', 'campaign_id',                         'grant'),   -- identifier/link
  ('CampaignTarget', 'metric',                              'grant'),   -- status/type value
  ('CampaignTarget', 'country_id',                          'grant'),   -- identifier/link
  ('CampaignTarget', 'region_id',                           'grant'),   -- identifier/link
  ('CampaignTarget', 'target_value',                        'grant'),   -- count/amount
  ('CampaignTarget', 'created_at',                          'grant'),   -- business timestamp
  ('Candidate', 'id',                                       'grant'),   -- identifier/link
  ('Candidate', 'user_id',                                  'grant'),   -- identifier/link
  ('Candidate', 'passport_number',                          'exclude'), -- personal data
  ('Candidate', 'passport_expiry',                          'exclude'), -- personal data
  ('Candidate', 'date_of_birth',                            'exclude'), -- personal data
  ('Candidate', 'nationality',                              'exclude'), -- personal data
  ('Candidate', 'second_nationality',                       'exclude'), -- personal data
  ('Candidate', 'gender',                                   'exclude'), -- personal data
  ('Candidate', 'current_occupation',                       'exclude'), -- personal data
  ('Candidate', 'highest_education',                        'exclude'), -- personal data
  ('Candidate', 'home_address',                             'exclude'), -- personal data
  ('Candidate', 'whatsapp_number',                          'exclude'), -- personal data
  ('Candidate', 'marital_status',                           'exclude'), -- personal data
  ('Candidate', 'created_at',                               'grant'),   -- business timestamp
  ('Candidate', 'updated_at',                               'grant'),   -- business timestamp
  ('Candidate', 'full_name',                                'exclude'), -- personal data
  ('Candidate', 'phone',                                    'exclude'), -- personal data
  ('Candidate', 'email',                                    'exclude'), -- personal data
  ('Candidate', 'desired_role',                             'exclude'), -- free text/JSON: may hold personal data
  ('Candidate', 'source',                                   'grant'),   -- status/type value
  ('Candidate', 'recruiter_id',                             'grant'),   -- identifier/link
  ('Candidate', 'country_name',                             'exclude'), -- personal data
  ('Candidate', 'country_id',                               'grant'),   -- identifier/link
  ('Candidate', 'lifecycle_status',                         'grant'),   -- status/type value
  ('Candidate', 'partner_id',                               'grant'),   -- identifier/link
  ('Candidate', 'referral_agent_id',                        'grant'),   -- identifier/link
  ('Candidate', 'referral_duplicate_flag',                  'grant'),   -- flag
  ('Candidate', 'consent_given',                            'grant'),   -- flag
  ('Candidate', 'consent_at',                               'grant'),   -- business timestamp
  ('Candidate', 'return_reason',                            'exclude'), -- free text/JSON: may hold personal data
  ('Candidate', 'screening_result',                         'grant'),   -- flag
  ('Candidate', 'screening_evaluated_at',                   'grant'),   -- business timestamp
  ('CandidateMessage', 'id',                                'grant'),   -- identifier/link
  ('CandidateMessage', 'candidate_id',                      'grant'),   -- identifier/link
  ('CandidateMessage', 'sender_id',                         'grant'),   -- identifier/link
  ('CandidateMessage', 'body',                              'exclude'), -- free text/JSON: may hold personal data
  ('CandidateMessage', 'created_at',                        'grant'),   -- business timestamp
  ('CandidateMessage', 'updated_at',                        'grant'),   -- business timestamp
  ('Case', 'id',                                            'grant'),   -- identifier/link
  ('Case', 'application_id',                                'grant'),   -- identifier/link
  ('Case', 'current_stage',                                 'exclude'), -- personal data
  ('Case', 'created_at',                                    'grant'),   -- business timestamp
  ('Case', 'updated_at',                                    'grant'),   -- business timestamp
  ('Case', 'ops_review_status',                             'grant'),   -- status/type value
  ('Case', 'ops_reviewed_by_id',                            'grant'),   -- identifier/link
  ('Case', 'ops_reviewed_at',                               'grant'),   -- business timestamp
  ('Case', 'ops_review_notes',                              'exclude'), -- free text/JSON: may hold personal data
  ('Case', 'status',                                        'grant'),   -- status/type value
  ('Case', 'rejected_at',                                   'grant'),   -- business timestamp
  ('Case', 'rejected_by_id',                                'grant'),   -- identifier/link
  ('Case', 'rejection_reason',                              'exclude'), -- free text/JSON: may hold personal data
  ('CasePayment', 'id',                                     'grant'),   -- identifier/link
  ('CasePayment', 'case_id',                                'grant'),   -- identifier/link
  ('CasePayment', 'job_payment_stage_id',                   'grant'),   -- identifier/link
  ('CasePayment', 'amount',                                 'grant'),   -- count/amount
  ('CasePayment', 'currency',                               'grant'),   -- status/type value
  ('CasePayment', 'receipt_reference',                      'exclude'), -- free text/JSON: may hold personal data
  ('CasePayment', 'receipt_document_id',                    'grant'),   -- identifier/link
  ('CasePayment', 'recorded_by',                            'exclude'), -- free text/JSON: may hold personal data
  ('CasePayment', 'recorded_at',                            'grant'),   -- business timestamp
  ('CasePayment', 'status',                                 'grant'),   -- status/type value
  ('CasePayment', 'stripe_payment_link_id',                 'grant'),   -- identifier/link
  ('CasePayment', 'stripe_payment_link_url',                'exclude'), -- free text/JSON: may hold personal data
  ('CasePayment', 'stripe_checkout_session_id',             'exclude'), -- secret-like
  ('CasePayment', 'sent_to_email',                          'exclude'), -- personal data
  ('CaseReminder', 'id',                                    'grant'),   -- identifier/link
  ('CaseReminder', 'case_id',                               'grant'),   -- identifier/link
  ('CaseReminder', 'channel',                               'grant'),   -- status/type value
  ('CaseReminder', 'recipient',                             'exclude'), -- free text/JSON: may hold personal data
  ('CaseReminder', 'message',                               'exclude'), -- personal data
  ('CaseReminder', 'sent_by',                               'exclude'), -- free text/JSON: may hold personal data
  ('CaseReminder', 'sent_at',                               'grant'),   -- business timestamp
  ('CaseStageEvent', 'id',                                  'grant'),   -- identifier/link
  ('CaseStageEvent', 'case_id',                             'grant'),   -- identifier/link
  ('CaseStageEvent', 'stage',                               'exclude'), -- personal data
  ('CaseStageEvent', 'owner_id',                            'grant'),   -- identifier/link
  ('CaseStageEvent', 'entered_at',                          'grant'),   -- business timestamp
  ('CaseStageEvent', 'completed_at',                        'grant'),   -- business timestamp
  ('CaseStageEvent', 'notes',                               'exclude'), -- free text/JSON: may hold personal data
  ('ConsultationBooking', 'id',                             'grant'),   -- identifier/link
  ('ConsultationBooking', 'full_name',                      'exclude'), -- personal data
  ('ConsultationBooking', 'email',                          'exclude'), -- personal data
  ('ConsultationBooking', 'phone',                          'exclude'), -- personal data
  ('ConsultationBooking', 'amount',                         'grant'),   -- count/amount
  ('ConsultationBooking', 'currency',                       'grant'),   -- status/type value
  ('ConsultationBooking', 'status',                         'grant'),   -- status/type value
  ('ConsultationBooking', 'stripe_checkout_session_id',     'exclude'), -- secret-like
  ('ConsultationBooking', 'stripe_payment_intent_id',       'grant'),   -- identifier/link
  ('ConsultationBooking', 'created_at',                     'grant'),   -- business timestamp
  ('Contract', 'id',                                        'grant'),   -- identifier/link
  ('Contract', 'case_id',                                   'grant'),   -- identifier/link
  ('Contract', 'content',                                   'exclude'), -- free text/JSON: may hold personal data
  ('Contract', 'status',                                    'grant'),   -- status/type value
  ('Contract', 'signed_by_name',                            'exclude'), -- personal data
  ('Contract', 'signed_at',                                 'grant'),   -- business timestamp
  ('Contract', 'signed_ip',                                 'exclude'), -- free text/JSON: may hold personal data
  ('Contract', 'created_by',                                'exclude'), -- free text/JSON: may hold personal data
  ('Contract', 'created_at',                                'grant'),   -- business timestamp
  ('Contract', 'updated_at',                                'grant'),   -- business timestamp
  ('Country', 'id',                                         'grant'),   -- reference data
  ('Country', 'name',                                       'grant'),   -- reference data
  ('Country', 'region_id',                                  'grant'),   -- reference data
  ('CountryDocumentRequirement', 'id',                      'grant'),   -- reference data
  ('CountryDocumentRequirement', 'country_id',              'grant'),   -- reference data
  ('CountryDocumentRequirement', 'document_type',           'grant'),   -- reference data
  ('CountryDocumentRequirement', 'created_at',              'grant'),   -- reference data
  ('Document', 'id',                                        'grant'),   -- identifier/link
  ('Document', 'candidate_id',                              'grant'),   -- identifier/link
  ('Document', 'partner_candidate_id',                      'grant'),   -- identifier/link
  ('Document', 'type',                                      'grant'),   -- status/type value
  ('Document', 'storage_path',                              'exclude'), -- free text/JSON: may hold personal data
  ('Document', 'verification_status',                       'grant'),   -- status/type value
  ('Document', 'verified_by',                               'exclude'), -- free text/JSON: may hold personal data
  ('Document', 'verified_at',                               'grant'),   -- business timestamp
  ('Document', 'uploaded_at',                               'grant'),   -- business timestamp
  ('Document', 'label',                                     'exclude'), -- free text/JSON: may hold personal data
  ('Document', 'scan_status',                               'grant'),   -- status/type value
  ('Document', 'scanned_at',                                'grant'),   -- business timestamp
  ('DocumentRequirementType', 'id',                         'grant'),   -- reference data
  ('DocumentRequirementType', 'key',                        'exclude'), -- secret-like
  ('DocumentRequirementType', 'label',                      'grant'),   -- reference data
  ('DocumentRequirementType', 'is_universal',               'grant'),   -- reference data
  ('DocumentRequirementType', 'sort_order',                 'grant'),   -- reference data
  ('DocumentRequirementType', 'created_at',                 'grant'),   -- reference data
  ('EmailTemplate', 'event',                                'grant'),   -- reference data
  ('EmailTemplate', 'subject',                              'grant'),   -- reference data
  ('EmailTemplate', 'body_html',                            'grant'),   -- reference data
  ('EmailTemplate', 'updated_at',                           'grant'),   -- reference data
  ('EmployerClient', 'id',                                  'grant'),   -- identifier/link
  ('EmployerClient', 'name',                                'exclude'), -- personal data
  ('EmployerClient', 'country',                             'exclude'), -- free text/JSON: may hold personal data
  ('EmployerClient', 'industry',                            'exclude'), -- free text/JSON: may hold personal data
  ('EmployerClient', 'contact_name',                        'exclude'), -- personal data
  ('EmployerClient', 'contact_email',                       'exclude'), -- personal data
  ('EmployerClient', 'contact_phone',                       'exclude'), -- personal data
  ('EmployerClient', 'status',                              'grant'),   -- status/type value
  ('EmployerClient', 'notes',                               'exclude'), -- free text/JSON: may hold personal data
  ('EmployerClient', 'created_at',                          'grant'),   -- business timestamp
  ('EmployerClient', 'updated_at',                          'grant'),   -- business timestamp
  ('Exception', 'id',                                       'grant'),   -- identifier/link
  ('Exception', 'reference',                                'exclude'), -- free text/JSON: may hold personal data
  ('Exception', 'category',                                 'grant'),   -- status/type value
  ('Exception', 'raised_by',                                'exclude'), -- free text/JSON: may hold personal data
  ('Exception', 'role_at_raise',                            'grant'),   -- status/type value
  ('Exception', 'country_id',                               'grant'),   -- identifier/link
  ('Exception', 'candidate_id',                             'grant'),   -- identifier/link
  ('Exception', 'reference_note',                           'exclude'), -- free text/JSON: may hold personal data
  ('Exception', 'issue_statement',                          'exclude'), -- free text/JSON: may hold personal data
  ('Exception', 'immediate_impact',                         'exclude'), -- free text/JSON: may hold personal data
  ('Exception', 'actions_taken',                            'exclude'), -- free text/JSON: may hold personal data
  ('Exception', 'root_cause',                               'exclude'), -- free text/JSON: may hold personal data
  ('Exception', 'options_considered',                       'exclude'), -- free text/JSON: may hold personal data
  ('Exception', 'recommendation',                           'exclude'), -- free text/JSON: may hold personal data
  ('Exception', 'decision_required',                        'exclude'), -- free text/JSON: may hold personal data
  ('Exception', 'decision_deadline',                        'grant'),   -- business timestamp
  ('Exception', 'escalation_level',                         'grant'),   -- status/type value
  ('Exception', 'status',                                   'grant'),   -- status/type value
  ('Exception', 'decision',                                 'grant'),   -- status/type value
  ('Exception', 'decision_notes',                           'exclude'), -- free text/JSON: may hold personal data
  ('Exception', 'decided_by',                               'exclude'), -- free text/JSON: may hold personal data
  ('Exception', 'decided_at',                               'grant'),   -- business timestamp
  ('Exception', 'created_at',                               'grant'),   -- business timestamp
  ('Exception', 'updated_at',                               'grant'),   -- business timestamp
  ('ExceptionCorrectiveAction', 'id',                       'grant'),   -- identifier/link
  ('ExceptionCorrectiveAction', 'exception_id',             'grant'),   -- identifier/link
  ('ExceptionCorrectiveAction', 'action',                   'exclude'),   -- free text: describes actions, may name people
  ('ExceptionCorrectiveAction', 'owner_id',                 'grant'),   -- identifier/link
  ('ExceptionCorrectiveAction', 'due_date',                 'grant'),   -- business timestamp
  ('ExceptionCorrectiveAction', 'success_measure',          'exclude'), -- free text/JSON: may hold personal data
  ('ExceptionCorrectiveAction', 'status',                   'grant'),   -- status/type value
  ('ExceptionCorrectiveAction', 'evidence',                 'exclude'), -- free text/JSON: may hold personal data
  ('ExceptionCorrectiveAction', 'created_at',               'grant'),   -- business timestamp
  ('ExceptionCorrectiveAction', 'updated_at',               'grant'),   -- business timestamp
  ('FeePolicy', 'id',                                       'grant'),   -- reference data
  ('FeePolicy', 'country_id',                               'grant'),   -- reference data
  ('FeePolicy', 'enabled',                                  'grant'),   -- reference data
  ('FeePolicy', 'documentation_amount',                     'grant'),   -- reference data
  ('FeePolicy', 'permit_amount',                            'grant'),   -- reference data
  ('FeePolicy', 'visa_amount',                              'grant'),   -- reference data
  ('FeePolicy', 'currency',                                 'grant'),   -- reference data
  ('FeePolicy', 'updated_by',                               'grant'),   -- reference data
  ('FeePolicy', 'updated_at',                               'grant'),   -- reference data
  ('InhouseCountryAssignment', 'id',                        'grant'),   -- identifier/link
  ('InhouseCountryAssignment', 'inhouse_supervisor_id',     'grant'),   -- identifier/link
  ('InhouseCountryAssignment', 'country_id',                'grant'),   -- identifier/link
  ('InhouseCountryAssignment', 'created_at',                'grant'),   -- business timestamp
  ('Job', 'id',                                             'grant'),   -- reference data
  ('Job', 'title',                                          'grant'),   -- reference data
  ('Job', 'country',                                        'grant'),   -- reference data
  ('Job', 'city',                                           'grant'),   -- reference data
  ('Job', 'category',                                       'grant'),   -- reference data
  ('Job', 'salary_range',                                   'grant'),   -- reference data
  ('Job', 'job_description',                                'grant'),   -- reference data
  ('Job', 'requirements',                                   'grant'),   -- reference data
  ('Job', 'status',                                         'grant'),   -- reference data
  ('Job', 'application_fee',                                'grant'),   -- reference data
  ('Job', 'created_at',                                     'grant'),   -- reference data
  ('Job', 'updated_at',                                     'grant'),   -- reference data
  ('Job', 'visa_type',                                      'grant'),   -- reference data
  ('Job', 'duration_permit',                                'grant'),   -- reference data
  ('Job', 'processing_time',                                'grant'),   -- reference data
  ('Job', 'service_fee_gbp',                                'grant'),   -- reference data
  ('Job', 'visa_success_rates',                             'grant'),   -- reference data
  ('Job', 'tier',                                           'grant'),   -- reference data
  ('Job', 'is_credit_service',                              'grant'),   -- reference data
  ('Job', 'partner_only',                                   'grant'),   -- reference data
  ('Job', 'employer_client_id',                             'grant'),   -- reference data
  ('JobPaymentStage', 'id',                                 'grant'),   -- reference data
  ('JobPaymentStage', 'job_id',                             'grant'),   -- reference data
  ('JobPaymentStage', 'order',                              'grant'),   -- reference data
  ('JobPaymentStage', 'label',                              'grant'),   -- reference data
  ('JobPaymentStage', 'percent',                            'grant'),   -- reference data
  ('JobPaymentStage', 'trigger_stage',                      'exclude'), -- personal data
  ('JobPaymentStage', 'stripe_product_id',                  'grant'),   -- reference data
  ('JobPaymentStage', 'stripe_price_id',                    'grant'),   -- reference data
  ('JobPaymentStage', 'synced_amount_gbp',                  'grant'),   -- reference data
  ('JobPaymentStage', 'created_at',                         'grant'),   -- reference data
  ('JobPaymentStage', 'updated_at',                         'grant'),   -- reference data
  ('JobPosition', 'id',                                     'grant'),   -- reference data
  ('JobPosition', 'job_sector_id',                          'grant'),   -- reference data
  ('JobPosition', 'title',                                  'grant'),   -- reference data
  ('JobPosition', 'city',                                   'grant'),   -- reference data
  ('JobPosition', 'created_at',                             'grant'),   -- reference data
  ('JobPosition', 'updated_at',                             'grant'),   -- reference data
  ('JobSector', 'id',                                       'grant'),   -- reference data
  ('JobSector', 'job_id',                                   'grant'),   -- reference data
  ('JobSector', 'sector',                                   'grant'),   -- reference data
  ('JobSector', 'created_at',                               'grant'),   -- reference data
  ('JobSector', 'updated_at',                               'grant'),   -- reference data
  ('KnowledgeArticle', 'id',                                'grant'),   -- reference data
  ('KnowledgeArticle', 'title',                             'grant'),   -- reference data
  ('KnowledgeArticle', 'category',                          'grant'),   -- reference data
  ('KnowledgeArticle', 'content',                           'grant'),   -- reference data
  ('KnowledgeArticle', 'created_at',                        'grant'),   -- reference data
  ('KnowledgeArticle', 'updated_at',                        'grant'),   -- reference data
  ('Partner', 'id',                                         'grant'),   -- identifier/link
  ('Partner', 'name',                                       'exclude'), -- personal data
  ('Partner', 'partner_type',                               'grant'),   -- status/type value
  ('Partner', 'country_of_operation',                       'exclude'), -- free text/JSON: may hold personal data
  ('Partner', 'business_registration_number',               'exclude'), -- free text/JSON: may hold personal data
  ('Partner', 'contact_name',                               'exclude'), -- personal data
  ('Partner', 'contact_email',                              'exclude'), -- personal data
  ('Partner', 'contact_phone',                              'exclude'), -- personal data
  ('Partner', 'status',                                     'grant'),   -- status/type value
  ('Partner', 'mou_status',                                 'grant'),   -- status/type value
  ('Partner', 'mou_signed_at',                              'grant'),   -- business timestamp
  ('Partner', 'notes',                                      'exclude'), -- free text/JSON: may hold personal data
  ('Partner', 'created_at',                                 'grant'),   -- business timestamp
  ('Partner', 'updated_at',                                 'grant'),   -- business timestamp
  ('Partner', 'user_id',                                    'grant'),   -- identifier/link
  ('PartnerCandidate', 'id',                                'grant'),   -- identifier/link
  ('PartnerCandidate', 'partner_id',                        'grant'),   -- identifier/link
  ('PartnerCandidate', 'status',                            'grant'),   -- status/type value
  ('PartnerCandidate', 'full_name',                         'exclude'), -- personal data
  ('PartnerCandidate', 'date_of_birth',                     'exclude'), -- personal data
  ('PartnerCandidate', 'nationality',                       'exclude'), -- personal data
  ('PartnerCandidate', 'second_nationality',                'exclude'), -- personal data
  ('PartnerCandidate', 'gender',                            'exclude'), -- personal data
  ('PartnerCandidate', 'passport_number',                   'exclude'), -- personal data
  ('PartnerCandidate', 'passport_expiry',                   'exclude'), -- personal data
  ('PartnerCandidate', 'current_occupation',                'exclude'), -- personal data
  ('PartnerCandidate', 'highest_education',                 'exclude'), -- personal data
  ('PartnerCandidate', 'home_address',                      'exclude'), -- personal data
  ('PartnerCandidate', 'phone',                             'exclude'), -- personal data
  ('PartnerCandidate', 'whatsapp_number',                   'exclude'), -- personal data
  ('PartnerCandidate', 'email',                             'exclude'), -- personal data
  ('PartnerCandidate', 'marital_status',                    'exclude'), -- personal data
  ('PartnerCandidate', 'job_id',                            'grant'),   -- identifier/link
  ('PartnerCandidate', 'job_position_id',                   'grant'),   -- identifier/link
  ('PartnerCandidate', 'earliest_travel_date',              'grant'),   -- business timestamp
  ('PartnerCandidate', 'prior_eu_visa_applied',             'grant'),   -- flag
  ('PartnerCandidate', 'prior_eu_visa_applied_details',     'exclude'), -- free text/JSON: may hold personal data
  ('PartnerCandidate', 'documents_available',               'exclude'), -- free text/JSON: may hold personal data
  ('PartnerCandidate', 'payment_plan_acknowledged',         'grant'),   -- flag
  ('PartnerCandidate', 'current_location_country_name',     'exclude'), -- personal data
  ('PartnerCandidate', 'current_location_country_id',       'grant'),   -- identifier/link
  ('PartnerCandidate', 'holds_schengen_visa',               'grant'),   -- flag
  ('PartnerCandidate', 'holds_schengen_visa_details',       'exclude'), -- free text/JSON: may hold personal data
  ('PartnerCandidate', 'prior_visa_refusals',               'grant'),   -- flag
  ('PartnerCandidate', 'prior_visa_refusals_details',       'exclude'), -- free text/JSON: may hold personal data
  ('PartnerCandidate', 'available_for_embassy_appointment', 'grant'),   -- flag
  ('PartnerCandidate', 'willing_to_start_within_30_days',   'grant'),   -- flag
  ('PartnerCandidate', 'preferred_contact_channel',         'grant'),   -- status/type value
  ('PartnerCandidate', 'reviewed_by',                       'exclude'), -- free text/JSON: may hold personal data
  ('PartnerCandidate', 'rejection_reason',                  'exclude'), -- free text/JSON: may hold personal data
  ('PartnerCandidate', 'bridged_candidate_id',              'grant'),   -- identifier/link
  ('PartnerCandidate', 'submitted_at',                      'grant'),   -- business timestamp
  ('PartnerCandidate', 'updated_at',                        'grant'),   -- business timestamp
  ('Payment', 'id',                                         'grant'),   -- identifier/link
  ('Payment', 'user_id',                                    'grant'),   -- identifier/link
  ('Payment', 'job_id',                                     'grant'),   -- identifier/link
  ('Payment', 'amount',                                     'grant'),   -- count/amount
  ('Payment', 'currency',                                   'grant'),   -- status/type value
  ('Payment', 'payment_method',                             'exclude'), -- free text/JSON: may hold personal data
  ('Payment', 'payment_status',                             'grant'),   -- status/type value
  ('Payment', 'transaction_id',                             'grant'),   -- identifier/link
  ('Payment', 'created_at',                                 'grant'),   -- business timestamp
  ('RecruiterNote', 'id',                                   'grant'),   -- identifier/link
  ('RecruiterNote', 'recruiter_id',                         'grant'),   -- identifier/link
  ('RecruiterNote', 'author_id',                            'grant'),   -- identifier/link
  ('RecruiterNote', 'message',                              'exclude'), -- personal data
  ('RecruiterNote', 'created_at',                           'grant'),   -- business timestamp
  ('RecruiterTarget', 'id',                                 'grant'),   -- identifier/link
  ('RecruiterTarget', 'campaign_target_id',                 'grant'),   -- identifier/link
  ('RecruiterTarget', 'recruiter_id',                       'grant'),   -- identifier/link
  ('RecruiterTarget', 'target_value',                       'grant'),   -- count/amount
  ('RecruiterTarget', 'set_by',                             'exclude'), -- free text/JSON: may hold personal data
  ('RecruiterTarget', 'created_at',                         'grant'),   -- business timestamp
  ('RecruiterTarget', 'updated_at',                         'grant'),   -- business timestamp
  ('ReferralAgent', 'id',                                   'grant'),   -- identifier/link
  ('ReferralAgent', 'full_name',                            'exclude'), -- personal data
  ('ReferralAgent', 'email',                                'exclude'), -- personal data
  ('ReferralAgent', 'phone',                                'exclude'), -- personal data
  ('ReferralAgent', 'whatsapp_number',                      'exclude'), -- personal data
  ('ReferralAgent', 'country',                              'exclude'), -- free text/JSON: may hold personal data
  ('ReferralAgent', 'country_id',                           'grant'),   -- identifier/link
  ('ReferralAgent', 'city',                                 'exclude'), -- free text/JSON: may hold personal data
  ('ReferralAgent', 'date_of_birth',                        'exclude'), -- personal data
  ('ReferralAgent', 'nationality',                          'exclude'), -- personal data
  ('ReferralAgent', 'preferred_contact_channel',            'exclude'), -- free text/JSON: may hold personal data
  ('ReferralAgent', 'previous_experience',                  'exclude'), -- free text/JSON: may hold personal data
  ('ReferralAgent', 'current_occupation',                   'exclude'), -- personal data
  ('ReferralAgent', 'network_size',                         'grant'),   -- count/amount
  ('ReferralAgent', 'social_media_profiles',                'exclude'), -- free text/JSON: may hold personal data
  ('ReferralAgent', 'promotion_plan',                       'exclude'), -- free text/JSON: may hold personal data
  ('ReferralAgent', 'payment_details',                      'exclude'), -- free text/JSON: may hold personal data
  ('ReferralAgent', 'status',                               'grant'),   -- status/type value
  ('ReferralAgent', 'referral_code',                        'exclude'), -- free text/JSON: may hold personal data
  ('ReferralAgent', 'email_verified',                       'exclude'), -- personal data
  ('ReferralAgent', 'approved_by_id',                       'grant'),   -- identifier/link
  ('ReferralAgent', 'approved_at',                          'grant'),   -- business timestamp
  ('ReferralAgent', 'rejection_reason',                     'exclude'), -- free text/JSON: may hold personal data
  ('ReferralAgent', 'suspended_reason',                     'exclude'), -- free text/JSON: may hold personal data
  ('ReferralAgent', 'user_id',                              'grant'),   -- identifier/link
  ('ReferralAgent', 'created_at',                           'grant'),   -- business timestamp
  ('ReferralAgent', 'updated_at',                           'grant'),   -- business timestamp
  ('ReferralAgentTarget', 'id',                             'grant'),   -- identifier/link
  ('ReferralAgentTarget', 'referral_agent_id',              'grant'),   -- identifier/link
  ('ReferralAgentTarget', 'period_start',                   'grant'),   -- business timestamp
  ('ReferralAgentTarget', 'period_end',                     'grant'),   -- business timestamp
  ('ReferralAgentTarget', 'target_referrals',               'grant'),   -- count/amount
  ('ReferralAgentTarget', 'set_by',                         'exclude'), -- free text/JSON: may hold personal data
  ('ReferralAgentTarget', 'created_at',                     'grant'),   -- business timestamp
  ('ReferralAgentTarget', 'updated_at',                     'grant'),   -- business timestamp
  ('ReferralCommission', 'id',                              'grant'),   -- identifier/link
  ('ReferralCommission', 'referral_agent_id',               'grant'),   -- identifier/link
  ('ReferralCommission', 'candidate_id',                    'grant'),   -- identifier/link
  ('ReferralCommission', 'case_id',                         'grant'),   -- identifier/link
  ('ReferralCommission', 'milestone',                       'grant'),   -- status/type value
  ('ReferralCommission', 'commission_rule_id',              'grant'),   -- identifier/link
  ('ReferralCommission', 'amount',                          'grant'),   -- count/amount
  ('ReferralCommission', 'currency',                        'grant'),   -- status/type value
  ('ReferralCommission', 'status',                          'grant'),   -- status/type value
  ('ReferralCommission', 'approved_by_id',                  'grant'),   -- identifier/link
  ('ReferralCommission', 'approved_at',                     'grant'),   -- business timestamp
  ('ReferralCommission', 'paid_by_id',                      'grant'),   -- identifier/link
  ('ReferralCommission', 'paid_at',                         'grant'),   -- business timestamp
  ('ReferralCommission', 'payment_reference',               'exclude'), -- free text/JSON: may hold personal data
  ('ReferralCommission', 'payment_method',                  'exclude'), -- free text/JSON: may hold personal data
  ('ReferralCommission', 'created_at',                      'grant'),   -- business timestamp
  ('ReferralCommission', 'updated_at',                      'grant'),   -- business timestamp
  ('ReferralCommissionRule', 'id',                          'grant'),   -- reference data
  ('ReferralCommissionRule', 'country_id',                  'grant'),   -- reference data
  ('ReferralCommissionRule', 'milestone',                   'grant'),   -- reference data
  ('ReferralCommissionRule', 'amount',                      'grant'),   -- reference data
  ('ReferralCommissionRule', 'currency',                    'grant'),   -- reference data
  ('ReferralCommissionRule', 'updated_by',                  'grant'),   -- reference data
  ('ReferralCommissionRule', 'created_at',                  'grant'),   -- reference data
  ('ReferralCommissionRule', 'updated_at',                  'grant'),   -- reference data
  ('Region', 'id',                                          'grant'),   -- reference data
  ('Region', 'name',                                        'grant'),   -- reference data
  ('Report', 'id',                                          'grant'),   -- identifier/link
  ('Report', 'type',                                        'grant'),   -- status/type value
  ('Report', 'scope_level',                                 'grant'),   -- status/type value
  ('Report', 'country_id',                                  'grant'),   -- identifier/link
  ('Report', 'submitted_by',                                'exclude'), -- free text/JSON: may hold personal data
  ('Report', 'period_start',                                'grant'),   -- business timestamp
  ('Report', 'period_end',                                  'grant'),   -- business timestamp
  ('Report', 'status',                                      'grant'),   -- status/type value
  ('Report', 'content',                                     'exclude'), -- free text/JSON: may hold personal data
  ('Report', 'return_reason',                               'exclude'), -- free text/JSON: may hold personal data
  ('Report', 'parent_report_id',                            'grant'),   -- identifier/link
  ('Report', 'created_at',                                  'grant'),   -- business timestamp
  ('Report', 'updated_at',                                  'grant'),   -- business timestamp
  ('RetentionFollowUp', 'id',                               'grant'),   -- identifier/link
  ('RetentionFollowUp', 'case_id',                          'grant'),   -- identifier/link
  ('RetentionFollowUp', 'due_at',                           'grant'),   -- business timestamp
  ('RetentionFollowUp', 'completed_at',                     'grant'),   -- business timestamp
  ('RetentionFollowUp', 'notes',                            'exclude'), -- free text/JSON: may hold personal data
  ('Sector', 'id',                                          'grant'),   -- reference data
  ('Sector', 'name',                                        'grant'),   -- reference data
  ('Sector', 'created_at',                                  'grant'),   -- reference data
  ('StaffKpiTarget', 'id',                                  'grant'),   -- identifier/link
  ('StaffKpiTarget', 'staff_id',                            'grant'),   -- identifier/link
  ('StaffKpiTarget', 'cycle',                               'grant'),   -- status/type value
  ('StaffKpiTarget', 'kpi_label',                           'exclude'), -- free text/JSON: may hold personal data
  ('StaffKpiTarget', 'target_value',                        'grant'),   -- count/amount
  ('StaffKpiTarget', 'set_by',                              'exclude'), -- free text/JSON: may hold personal data
  ('StaffKpiTarget', 'created_at',                          'grant'),   -- business timestamp
  ('StaffKpiTarget', 'updated_at',                          'grant'),   -- business timestamp
  ('StaffScorecard', 'id',                                  'grant'),   -- identifier/link
  ('StaffScorecard', 'staff_id',                            'grant'),   -- identifier/link
  ('StaffScorecard', 'reviewer_id',                         'grant'),   -- identifier/link
  ('StaffScorecard', 'period_month',                        'grant'),   -- business timestamp
  ('StaffScorecard', 'status',                              'grant'),   -- status/type value
  ('StaffScorecard', 'overall_score',                       'grant'),   -- count/amount
  ('StaffScorecard', 'performance_category',                'exclude'), -- free text/JSON: may hold personal data
  ('StaffScorecard', 'required_action',                     'exclude'), -- free text/JSON: may hold personal data
  ('StaffScorecard', 'review_date',                         'grant'),   -- business timestamp
  ('StaffScorecard', 'created_at',                          'grant'),   -- business timestamp
  ('StaffScorecard', 'updated_at',                          'grant'),   -- business timestamp
  ('StaffScorecardArea', 'id',                              'grant'),   -- identifier/link
  ('StaffScorecardArea', 'scorecard_id',                    'grant'),   -- identifier/link
  ('StaffScorecardArea', 'area_key',                        'exclude'), -- secret-like
  ('StaffScorecardArea', 'weight',                          'grant'),   -- count/amount
  ('StaffScorecardArea', 'rating',                          'grant'),   -- count/amount
  ('StaffScorecardArea', 'evidence',                        'exclude'), -- free text/JSON: may hold personal data
  ('SystemSetting', 'key',                                  'exclude'), -- secret-like
  ('SystemSetting', 'value',                                'exclude'), -- configuration value
  ('SystemSetting', 'description',                          'exclude'), -- free text/JSON: may hold personal data
  ('SystemSetting', 'updated_at',                           'grant'),   -- business timestamp
  ('User', 'id',                                            'grant'),   -- identifier/link
  ('User', 'full_name',                                     'exclude'), -- personal data
  ('User', 'email',                                         'exclude'), -- personal data
  ('User', 'password_hash',                                 'exclude'), -- secret-like
  ('User', 'google_id',                                     'grant'),   -- identifier/link
  ('User', 'phone',                                         'exclude'), -- personal data
  ('User', 'country',                                       'exclude'), -- free text/JSON: may hold personal data
  ('User', 'role',                                          'grant'),   -- status/type value
  ('User', 'email_verified',                                'exclude'), -- personal data
  ('User', 'created_at',                                    'grant'),   -- business timestamp
  ('User', 'updated_at',                                    'grant'),   -- business timestamp
  ('User', 'supervisor_id',                                 'grant'),   -- identifier/link
  ('User', 'assigned_country_id',                           'grant');   -- identifier/link
