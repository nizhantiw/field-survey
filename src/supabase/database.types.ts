/**
 * Row shapes for the FieldSurvey schema in supabase/migrations.
 * `supabase gen types` was not run: this environment has no Supabase CLI.
 * Regenerate this file with `supabase gen types typescript --local` after the
 * CLI is available, and replace this hand-maintained copy.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type AppRole = 'owner' | 'admin' | 'researcher' | 'fieldworker' | 'viewer';
export type IngestionStatus = 'pending' | 'complete';
export type ReviewStatus = 'unreviewed' | 'accepted' | 'rejected' | 'needs_followup';
export type AttachmentStatus = 'expected' | 'uploaded' | 'verified';

export interface Database {
  public: {
    Tables: {
      profiles: { Row: { id: string; email: string; display_name: string; created_at: string; updated_at: string } };
      organizations: { Row: { id: string; name: string; created_by: string; created_at: string; updated_at: string } };
      organization_members: { Row: { id: string; organization_id: string; user_id: string; role: AppRole; created_at: string; updated_at: string } };
      projects: { Row: { id: string; organization_id: string; name: string; description: string; created_by: string; created_at: string; updated_at: string } };
      project_members: { Row: { id: string; project_id: string; user_id: string; role: AppRole; created_at: string; updated_at: string } };
      forms: { Row: { id: string; project_id: string; title: string; draft_schema: Json; current_version_id: string | null; created_by: string; created_at: string; updated_at: string } };
      form_versions: { Row: { id: string; form_id: string; project_id: string; version_number: number; schema: Json; published_by: string; published_at: string } };
      submissions: {
        Row: {
          id: string;
          project_id: string;
          form_id: string;
          form_version_id: string;
          collector_id: string;
          answers: Json;
          location: Json | null;
          client_captured_at: string;
          server_received_at: string;
          payload_hash: string;
          ingestion_status: IngestionStatus;
          review_status: ReviewStatus;
          created_at: string;
          updated_at: string;
        };
      };
      submission_attachments: {
        Row: {
          id: string;
          submission_id: string;
          project_id: string;
          question_id: string;
          storage_path: string;
          content_type: string;
          byte_size: number;
          checksum: string;
          status: AttachmentStatus;
          created_at: string;
        };
      };
      map_packages: { Row: { id: string; project_id: string; name: string; version: number; manifest: Json; status: string; created_by: string; created_at: string } };
      audit_events: { Row: { id: string; organization_id: string | null; actor_id: string | null; action: string; entity_type: string; entity_id: string | null; metadata: Json; created_at: string } };
    };
    Views: {
      organization_directory: { Row: { id: string; name: string; role: AppRole } };
      organization_member_directory: { Row: { organization_id: string; user_id: string; email: string; display_name: string; role: AppRole } };
      project_directory: { Row: { id: string; organization_id: string; name: string; description: string; role: AppRole } };
    };
    Functions: {
      create_organization: { Args: { org_name: string }; Returns: string };
      test_failing_org_creation: { Args: { p_user_id: string }; Returns: undefined };
      set_member_role: { Args: { p_org_id: string; p_user_id: string; p_role: AppRole }; Returns: undefined };
      create_project: { Args: { p_org_id: string; p_name: string; p_description: string }; Returns: Json };
      publish_form_version: { Args: { p_form_id: string; p_schema: Json }; Returns: string };
      create_or_recover_submission: {
        Args: {
          p_id: string;
          p_project_id: string;
          p_form_version_id: string;
          p_answers: Json;
          p_location: Json | null;
          p_client_captured_at: string;
          p_payload_hash: string;
        };
        Returns: Json;
      };
      register_submission_attachments: { Args: { p_submission_id: string; p_attachments: Json }; Returns: undefined };
      mark_attachment_uploaded: { Args: { p_id: string; p_checksum: string }; Returns: undefined };
      verify_submission_attachments: { Args: { p_submission_id: string }; Returns: Json };
      finalize_submission: { Args: { p_id: string; p_payload_hash: string }; Returns: Json };
      set_review_status: { Args: { p_id: string; p_status: ReviewStatus }; Returns: Json };
    };
  };
}
