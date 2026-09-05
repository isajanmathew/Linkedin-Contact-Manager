export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      connections: {
        Row: {
          avatar_url: string | null
          connected_at: string | null
          connection_degree: string | null
          created_at: string | null
          current_company: string | null
          current_role: string | null
          email: string | null
          first_name: string | null
          full_name: string
          headline: string | null
          id: string
          is_starred: boolean | null
          last_interaction_at: string | null
          last_name: string | null
          location: string | null
          next_followup_at: string | null
          phone: string | null
          profile_url: string | null
          relationship_status: string | null
          tags: string[] | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          connected_at?: string | null
          connection_degree?: string | null
          created_at?: string | null
          current_company?: string | null
          current_role?: string | null
          email?: string | null
          first_name?: string | null
          full_name: string
          headline?: string | null
          id: string
          is_starred?: boolean | null
          last_interaction_at?: string | null
          last_name?: string | null
          location?: string | null
          next_followup_at?: string | null
          phone?: string | null
          profile_url?: string | null
          relationship_status?: string | null
          tags?: string[] | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          connected_at?: string | null
          connection_degree?: string | null
          created_at?: string | null
          current_company?: string | null
          current_role?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string
          headline?: string | null
          id?: string
          is_starred?: boolean | null
          last_interaction_at?: string | null
          last_name?: string | null
          location?: string | null
          next_followup_at?: string | null
          phone?: string | null
          profile_url?: string | null
          relationship_status?: string | null
          tags?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
          company: string | null
          contact_date: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          follow_up_date: string | null
          full_name: string | null
          id: string
          job_title: string | null
          location: string | null
          modified_at: string
          notes: string | null
          owner_key: string
          phone: string | null
          profile_picture: string | null
          profile_url: string
          tags: string[]
        }
        Insert: {
          company?: string | null
          contact_date?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          follow_up_date?: string | null
          full_name?: string | null
          id?: string
          job_title?: string | null
          location?: string | null
          modified_at?: string
          notes?: string | null
          owner_key: string
          phone?: string | null
          profile_picture?: string | null
          profile_url: string
          tags?: string[]
        }
        Update: {
          company?: string | null
          contact_date?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          follow_up_date?: string | null
          full_name?: string | null
          id?: string
          job_title?: string | null
          location?: string | null
          modified_at?: string
          notes?: string | null
          owner_key?: string
          phone?: string | null
          profile_picture?: string | null
          profile_url?: string
          tags?: string[]
        }
        Relationships: []
      }
      notes: {
        Row: {
          connection_id: string | null
          content: string
          created_at: string | null
          created_by_extension: boolean | null
          id: string
          interaction_type: string | null
          reminder_date: string | null
          sentiment: string | null
        }
        Insert: {
          connection_id?: string | null
          content: string
          created_at?: string | null
          created_by_extension?: boolean | null
          id: string
          interaction_type?: string | null
          reminder_date?: string | null
          sentiment?: string | null
        }
        Update: {
          connection_id?: string | null
          content?: string
          created_at?: string | null
          created_by_extension?: boolean | null
          id?: string
          interaction_type?: string | null
          reminder_date?: string | null
          sentiment?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notes_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_events: {
        Row: {
          changed_at: string
          id: number
          operation: string
          owner_fingerprint: string
          record_id: string
        }
        Insert: {
          changed_at?: string
          id?: number
          operation: string
          owner_fingerprint: string
          record_id: string
        }
        Update: {
          changed_at?: string
          id?: number
          operation?: string
          owner_fingerprint?: string
          record_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      request_owner_key: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
