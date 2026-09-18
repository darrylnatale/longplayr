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
      activity: {
        Row: {
          actor_id: string
          collection_entry_id: string | null
          created_at: string
          id: string
          list_id: string | null
          relisten_event_id: string | null
          review_id: string | null
          type: Database["public"]["Enums"]["activity_type"]
        }
        Insert: {
          actor_id: string
          collection_entry_id?: string | null
          created_at?: string
          id?: string
          list_id?: string | null
          relisten_event_id?: string | null
          review_id?: string | null
          type: Database["public"]["Enums"]["activity_type"]
        }
        Update: {
          actor_id?: string
          collection_entry_id?: string | null
          created_at?: string
          id?: string
          list_id?: string | null
          relisten_event_id?: string | null
          review_id?: string | null
          type?: Database["public"]["Enums"]["activity_type"]
        }
        Relationships: [
          {
            foreignKeyName: "activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_collection_entry_id_fkey"
            columns: ["collection_entry_id"]
            isOneToOne: false
            referencedRelation: "collection_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_relisten_event_id_fkey"
            columns: ["relisten_event_id"]
            isOneToOne: true
            referencedRelation: "relisten_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: true
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
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
          hydration_status: Database["public"]["Enums"]["hydration_status"]
          hydration_updated_at: string | null
          id: string
          mbid: string
          popularity_score: number | null
          primary_type: Database["public"]["Enums"]["album_type"]
          representative_release_id: string | null
          search_vector: unknown
          secondary_types: Database["public"]["Enums"]["album_secondary_type"][]
          slug: string
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
          hydration_status?: Database["public"]["Enums"]["hydration_status"]
          hydration_updated_at?: string | null
          id?: string
          mbid: string
          popularity_score?: number | null
          primary_type: Database["public"]["Enums"]["album_type"]
          representative_release_id?: string | null
          search_vector?: unknown
          secondary_types?: Database["public"]["Enums"]["album_secondary_type"][]
          slug?: string
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
          hydration_status?: Database["public"]["Enums"]["hydration_status"]
          hydration_updated_at?: string | null
          id?: string
          mbid?: string
          popularity_score?: number | null
          primary_type?: Database["public"]["Enums"]["album_type"]
          representative_release_id?: string | null
          search_vector?: unknown
          secondary_types?: Database["public"]["Enums"]["album_secondary_type"][]
          slug?: string
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
          slug: string
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
          slug?: string
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
          slug?: string
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
      collection_entries: {
        Row: {
          added_at: string
          album_id: string
          id: string
          liked: boolean
          listened_on: string | null
          rating: number | null
          relisten_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          added_at?: string
          album_id: string
          id?: string
          liked?: boolean
          listened_on?: string | null
          rating?: number | null
          relisten_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          added_at?: string
          album_id?: string
          id?: string
          liked?: boolean
          listened_on?: string | null
          rating?: number | null
          relisten_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_entries_album_id_fkey"
            columns: ["album_id"]
            isOneToOne: false
            referencedRelation: "albums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_chart_entries: {
        Row: {
          album_id: string
          chart: string
          collection_count: number
          computed_at: string
          distinct_users: number
          rank: number
        }
        Insert: {
          album_id: string
          chart: string
          collection_count: number
          computed_at?: string
          distinct_users: number
          rank: number
        }
        Update: {
          album_id?: string
          chart?: string
          collection_count?: number
          computed_at?: string
          distinct_users?: number
          rank?: number
        }
        Relationships: [
          {
            foreignKeyName: "discovery_chart_entries_album_id_fkey"
            columns: ["album_id"]
            isOneToOne: false
            referencedRelation: "albums"
            referencedColumns: ["id"]
          },
        ]
      }
      favourite_albums: {
        Row: {
          album_id: string
          created_at: string
          id: string
          position: number
          user_id: string
        }
        Insert: {
          album_id: string
          created_at?: string
          id?: string
          position: number
          user_id: string
        }
        Update: {
          album_id?: string
          created_at?: string
          id?: string
          position?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favourite_albums_album_id_fkey"
            columns: ["album_id"]
            isOneToOne: false
            referencedRelation: "albums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favourite_albums_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      follows: {
        Row: {
          created_at: string
          followee_id: string
          follower_id: string
          id: string
        }
        Insert: {
          created_at?: string
          followee_id: string
          follower_id: string
          id?: string
        }
        Update: {
          created_at?: string
          followee_id?: string
          follower_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follows_followee_id_fkey"
            columns: ["followee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
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
      list_items: {
        Row: {
          album_id: string
          created_at: string
          id: string
          list_id: string
          position: number
        }
        Insert: {
          album_id: string
          created_at?: string
          id?: string
          list_id: string
          position: number
        }
        Update: {
          album_id?: string
          created_at?: string
          id?: string
          list_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "list_items_album_id_fkey"
            columns: ["album_id"]
            isOneToOne: false
            referencedRelation: "albums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_items_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
        ]
      }
      list_likes: {
        Row: {
          created_at: string
          id: string
          list_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          list_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          list_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_likes_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lists: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_ranked: boolean
          status: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_ranked?: boolean
          status?: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_ranked?: boolean
          status?: Database["public"]["Enums"]["content_status"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lists_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string
          created_at: string
          follow_id: string | null
          id: string
          list_like_id: string | null
          read_at: string | null
          recipient_id: string
          review_like_id: string | null
          type: Database["public"]["Enums"]["notification_type"]
        }
        Insert: {
          actor_id: string
          created_at?: string
          follow_id?: string | null
          id?: string
          list_like_id?: string | null
          read_at?: string | null
          recipient_id: string
          review_like_id?: string | null
          type: Database["public"]["Enums"]["notification_type"]
        }
        Update: {
          actor_id?: string
          created_at?: string
          follow_id?: string | null
          id?: string
          list_like_id?: string | null
          read_at?: string | null
          recipient_id?: string
          review_like_id?: string | null
          type?: Database["public"]["Enums"]["notification_type"]
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_follow_id_fkey"
            columns: ["follow_id"]
            isOneToOne: true
            referencedRelation: "follows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_list_like_id_fkey"
            columns: ["list_like_id"]
            isOneToOne: true
            referencedRelation: "list_likes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_review_like_id_fkey"
            columns: ["review_like_id"]
            isOneToOne: true
            referencedRelation: "review_likes"
            referencedColumns: ["id"]
          },
        ]
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
          tracklist_status: Database["public"]["Enums"]["tracklist_status"]
          tracklist_updated_at: string | null
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
          tracklist_status?: Database["public"]["Enums"]["tracklist_status"]
          tracklist_updated_at?: string | null
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
          tracklist_status?: Database["public"]["Enums"]["tracklist_status"]
          tracklist_updated_at?: string | null
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
      relisten_events: {
        Row: {
          collection_entry_id: string
          id: string
          occurred_at: string
        }
        Insert: {
          collection_entry_id: string
          id?: string
          occurred_at?: string
        }
        Update: {
          collection_entry_id?: string
          id?: string
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "relisten_events_collection_entry_id_fkey"
            columns: ["collection_entry_id"]
            isOneToOne: false
            referencedRelation: "collection_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      reserved_handles: {
        Row: {
          handle: string
        }
        Insert: {
          handle: string
        }
        Update: {
          handle?: string
        }
        Relationships: []
      }
      review_likes: {
        Row: {
          created_at: string
          id: string
          review_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          review_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          review_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_likes_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          body: string
          collection_entry_id: string
          created_at: string
          id: string
          status: Database["public"]["Enums"]["content_status"]
          updated_at: string
        }
        Insert: {
          body: string
          collection_entry_id: string
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Update: {
          body?: string
          collection_entry_id?: string
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_collection_entry_id_fkey"
            columns: ["collection_entry_id"]
            isOneToOne: true
            referencedRelation: "collection_entries"
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
      upstream_payloads: {
        Row: {
          fetched_at: string
          kind: string
          payload: Json
          source: string
          source_id: string
        }
        Insert: {
          fetched_at?: string
          kind: string
          payload: Json
          source: string
          source_id: string
        }
        Update: {
          fetched_at?: string
          kind?: string
          payload?: Json
          source?: string
          source_id?: string
        }
        Relationships: []
      }
      want_to_listen: {
        Row: {
          added_at: string
          album_id: string
          id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          album_id: string
          id?: string
          user_id: string
        }
        Update: {
          added_at?: string
          album_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "want_to_listen_album_id_fkey"
            columns: ["album_id"]
            isOneToOne: false
            referencedRelation: "albums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "want_to_listen_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_list_item: {
        Args: { p_album_id: string; p_list_id: string }
        Returns: undefined
      }
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
      ensure_collection_entry: {
        Args: { p_album_id: string; p_listened_on?: string; p_user_id: string }
        Returns: {
          added_at: string
          album_id: string
          id: string
          liked: boolean
          listened_on: string | null
          rating: number | null
          relisten_count: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "collection_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      feed_activity: {
        Args: {
          p_before?: string
          p_before_id?: string
          p_limit: number
          p_viewer: string
        }
        Returns: {
          actor_avatar_url: string
          actor_display_name: string
          actor_handle: string
          album_artwork_status: Database["public"]["Enums"]["artwork_status"]
          album_credit: string
          album_mbid: string
          album_title: string
          created_at: string
          id: string
          list_id: string
          list_title: string
          rating: number
          review_body: string
          type: Database["public"]["Enums"]["activity_type"]
        }[]
      }
      refresh_popular_this_week: { Args: never; Returns: number }
      remove_list_item: {
        Args: { p_album_id: string; p_list_id: string }
        Returns: undefined
      }
      reorder_list_item: {
        Args: { p_item_id: string; p_to_position: number }
        Returns: undefined
      }
      search_albums: {
        Args: { max_results?: number; query: string }
        Returns: {
          artists: Json
          artwork_status: Database["public"]["Enums"]["artwork_status"]
          display_credit: string
          first_release_date: string
          first_release_date_precision: Database["public"]["Enums"]["date_precision"]
          id: string
          mbid: string
          popularity_score: number
          primary_type: Database["public"]["Enums"]["album_type"]
          slug: string
          text_rank: number
          tier: number
          title: string
        }[]
      }
      search_artists: {
        Args: { max_results?: number; query: string }
        Returns: {
          album_count: number
          disambiguation: string
          id: string
          mbid: string
          name: string
          slug: string
          tier: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      slugify: { Args: { value: string }; Returns: string }
    }
    Enums: {
      activity_type:
        | "listened"
        | "relistened"
        | "rated"
        | "reviewed"
        | "list_created"
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
      artwork_status: "pending" | "found" | "absent" | "failed"
      content_status: "live" | "removed"
      date_precision: "day" | "month" | "year"
      hydration_status: "pending" | "fetched"
      job_kind:
        | "ingest_release_group"
        | "fetch_artwork"
        | "fetch_releases"
        | "fetch_tracklist"
        | "discover_curated_artist"
      job_status: "pending" | "running" | "succeeded" | "failed"
      notification_type: "followed" | "review_liked" | "list_liked"
      tracklist_status: "pending" | "found" | "absent" | "failed"
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
      activity_type: [
        "listened",
        "relistened",
        "rated",
        "reviewed",
        "list_created",
      ],
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
      artwork_status: ["pending", "found", "absent", "failed"],
      content_status: ["live", "removed"],
      date_precision: ["day", "month", "year"],
      hydration_status: ["pending", "fetched"],
      job_kind: [
        "ingest_release_group",
        "fetch_artwork",
        "fetch_releases",
        "fetch_tracklist",
        "discover_curated_artist",
      ],
      job_status: ["pending", "running", "succeeded", "failed"],
      notification_type: ["followed", "review_liked", "list_liked"],
      tracklist_status: ["pending", "found", "absent", "failed"],
      user_status: ["active", "suspended", "banned"],
    },
  },
} as const

