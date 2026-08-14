export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      album_artists: {
        Row: {
          album_id: string
          artist_id: string
          position: number
        }
        Insert: {
          album_id: string
          artist_id: string
          position: number
        }
        Update: {
          album_id?: string
          artist_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "album_artists_album_id_fkey"
            columns: ["album_id"]
            isOneToOne: false
            referencedRelation: "albums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "album_artists_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
        ]
      }
      albums: {
        Row: {
          artwork_status: Database["public"]["Enums"]["artwork_status"]
          artwork_updated_at: string | null
          created_at: string
          display_credit: string
          first_release_date: string | null
          first_release_date_precision:
            | Database["public"]["Enums"]["date_precision"]
            | null
          id: string
          mbid: string
          primary_type: Database["public"]["Enums"]["album_type"]
          representative_release_id: string | null
          search_vector: unknown
          secondary_types: Database["public"]["Enums"]["album_secondary_type"][]
          title: string
          updated_at: string
        }
        Insert: {
          artwork_status?: Database["public"]["Enums"]["artwork_status"]
          artwork_updated_at?: string | null
          created_at?: string
          display_credit: string
          first_release_date?: string | null
          first_release_date_precision?:
            | Database["public"]["Enums"]["date_precision"]
            | null
          id?: string
          mbid: string
          primary_type: Database["public"]["Enums"]["album_type"]
          representative_release_id?: string | null
          search_vector?: unknown
          secondary_types?: Database["public"]["Enums"]["album_secondary_type"][]
          title: string
          updated_at?: string
        }
        Update: {
          artwork_status?: Database["public"]["Enums"]["artwork_status"]
          artwork_updated_at?: string | null
          created_at?: string
          display_credit?: string
          first_release_date?: string | null
          first_release_date_precision?:
            | Database["public"]["Enums"]["date_precision"]
            | null
          id?: string
          mbid?: string
          primary_type?: Database["public"]["Enums"]["album_type"]
          representative_release_id?: string | null
          search_vector?: unknown
          secondary_types?: Database["public"]["Enums"]["album_secondary_type"][]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "albums_representative_release_fk"
            columns: ["representative_release_id"]
            isOneToOne: false
            referencedRelation: "releases"
            referencedColumns: ["id"]
          },
        ]
      }
      artists: {
        Row: {
          created_at: string
          disambiguation: string | null
          id: string
          mbid: string
          name: string
          search_vector: unknown
          sort_name: string
          type: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          disambiguation?: string | null
          id?: string
          mbid: string
          name: string
          search_vector?: unknown
          sort_name: string
          type?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          disambiguation?: string | null
          id?: string
          mbid?: string
          name?: string
          search_vector?: unknown
          sort_name?: string
          type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      catalogue_additions: {
        Row: {
          album_mbid: string
          created_at: string
          id: number
          user_id: string | null
        }
        Insert: {
          album_mbid: string
          created_at?: string
          id?: never
          user_id?: string | null
        }
        Update: {
          album_mbid?: string
          created_at?: string
          id?: never
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalogue_additions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_jobs: {
        Row: {
          attempts: number
          created_at: string
          id: number
          kind: Database["public"]["Enums"]["job_kind"]
          last_error: string | null
          max_attempts: number
          priority: number
          run_after: string
          status: Database["public"]["Enums"]["job_status"]
          target_mbid: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: never
          kind: Database["public"]["Enums"]["job_kind"]
          last_error?: string | null
          max_attempts?: number
          priority?: number
          run_after?: string
          status?: Database["public"]["Enums"]["job_status"]
          target_mbid: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: never
          kind?: Database["public"]["Enums"]["job_kind"]
          last_error?: string | null
          max_attempts?: number
          priority?: number
          run_after?: string
          status?: Database["public"]["Enums"]["job_status"]
          target_mbid?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          handle: string
          id: string
          status: Database["public"]["Enums"]["user_status"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          handle: string
          id: string
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          handle?: string
          id?: string
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Relationships: []
      }
      releases: {
        Row: {
          album_id: string
          country: string | null
          created_at: string
          disambiguation: string | null
          format: string | null
          id: string
          label: string | null
          mbid: string
          release_date: string | null
          release_date_precision:
            | Database["public"]["Enums"]["date_precision"]
            | null
          status: string | null
          title: string
          track_count: number | null
          updated_at: string
        }
        Insert: {
          album_id: string
          country?: string | null
          created_at?: string
          disambiguation?: string | null
          format?: string | null
          id?: string
          label?: string | null
          mbid: string
          release_date?: string | null
          release_date_precision?:
            | Database["public"]["Enums"]["date_precision"]
            | null
          status?: string | null
          title: string
          track_count?: number | null
          updated_at?: string
        }
        Update: {
          album_id?: string
          country?: string | null
          created_at?: string
          disambiguation?: string | null
          format?: string | null
          id?: string
          label?: string | null
          mbid?: string
          release_date?: string | null
          release_date_precision?:
            | Database["public"]["Enums"]["date_precision"]
            | null
          status?: string | null
          title?: string
          track_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "releases_album_id_fkey"
            columns: ["album_id"]
            isOneToOne: false
            referencedRelation: "albums"
            referencedColumns: ["id"]
          },
        ]
      }
      tracks: {
        Row: {
          id: string
          length_ms: number | null
          medium_position: number
          position: number
          release_id: string
          title: string
        }
        Insert: {
          id?: string
          length_ms?: number | null
          medium_position?: number
          position: number
          release_id: string
          title: string
        }
        Update: {
          id?: string
          length_ms?: number | null
          medium_position?: number
          position?: number
          release_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracks_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "releases"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_ingestion_jobs: {
        Args: { batch_size: number }
        Returns: {
          attempts: number
          created_at: string
          id: number
          kind: Database["public"]["Enums"]["job_kind"]
          last_error: string | null
          max_attempts: number
          priority: number
          run_after: string
          status: Database["public"]["Enums"]["job_status"]
          target_mbid: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ingestion_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      album_secondary_type:
        | "compilation"
        | "soundtrack"
        | "live"
        | "remix"
        | "mixtape"
        | "demo"
        | "spokenword"
        | "interview"
        | "audiobook"
        | "dj_mix"
      album_type: "album" | "ep" | "other"
      artwork_status: "pending" | "found" | "absent"
      date_precision: "day" | "month" | "year"
      job_kind: "ingest_release_group" | "fetch_artwork" | "fetch_releases"
      job_status: "pending" | "running" | "succeeded" | "failed"
      user_status: "active" | "suspended" | "banned"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      album_secondary_type: [
        "compilation",
        "soundtrack",
        "live",
        "remix",
        "mixtape",
        "demo",
        "spokenword",
        "interview",
        "audiobook",
        "dj_mix",
      ],
      album_type: ["album", "ep", "other"],
      artwork_status: ["pending", "found", "absent"],
      date_precision: ["day", "month", "year"],
      job_kind: ["ingest_release_group", "fetch_artwork", "fetch_releases"],
      job_status: ["pending", "running", "succeeded", "failed"],
      user_status: ["active", "suspended", "banned"],
    },
  },
} as const

