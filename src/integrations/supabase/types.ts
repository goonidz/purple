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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      content_calendar: {
        Row: {
          audio_url: string | null
          created_at: string
          id: string
          notes: string | null
          project_id: string | null
          scheduled_date: string
          script: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          audio_url?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          project_id?: string | null
          scheduled_date: string
          script?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          audio_url?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          project_id?: string | null
          scheduled_date?: string
          script?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_calendar_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_descriptions: {
        Row: {
          created_at: string | null
          descriptions: string[]
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          descriptions?: string[]
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          descriptions?: string[]
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: []
      }
      generated_tags: {
        Row: {
          created_at: string
          id: string
          project_id: string
          tags: string[]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          tags?: string[]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          tags?: string[]
          user_id?: string
        }
        Relationships: []
      }
      generated_thumbnails: {
        Row: {
          created_at: string
          id: string
          preset_name: string | null
          project_id: string | null
          prompts: Json
          thumbnail_urls: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          preset_name?: string | null
          project_id?: string | null
          prompts?: Json
          thumbnail_urls?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          preset_name?: string | null
          project_id?: string | null
          prompts?: Json
          thumbnail_urls?: Json
          user_id?: string
        }
        Relationships: []
      }
      generated_titles: {
        Row: {
          created_at: string
          id: string
          project_id: string
          titles: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          titles?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          titles?: Json
          user_id?: string
        }
        Relationships: []
      }
      generation_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          job_type: Database["public"]["Enums"]["job_type"]
          metadata: Json | null
          progress: number | null
          project_id: string | null
          status: Database["public"]["Enums"]["job_status"]
          total: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_type: Database["public"]["Enums"]["job_type"]
          metadata?: Json | null
          progress?: number | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          total?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_type?: Database["public"]["Enums"]["job_type"]
          metadata?: Json | null
          progress?: number | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          total?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      lora_presets: {
        Row: {
          created_at: string
          id: string
          lora_steps: number
          lora_url: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lora_steps?: number
          lora_url: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lora_steps?: number
          lora_url?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pending_predictions: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          job_id: string | null
          metadata: Json | null
          prediction_id: string
          prediction_type: string
          project_id: string | null
          result_url: string | null
          scene_index: number | null
          status: string | null
          thumbnail_index: number | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          job_id?: string | null
          metadata?: Json | null
          prediction_id: string
          prediction_type: string
          project_id?: string | null
          result_url?: string | null
          scene_index?: number | null
          status?: string | null
          thumbnail_index?: number | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          job_id?: string | null
          metadata?: Json | null
          prediction_id?: string
          prediction_type?: string
          project_id?: string | null
          result_url?: string | null
          scene_index?: number | null
          status?: string | null
          thumbnail_index?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_predictions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_predictions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      presets: {
        Row: {
          aspect_ratio: string | null
          created_at: string
          example_prompts: Json | null
          id: string
          image_height: number | null
          image_model: string | null
          image_width: number | null
          lora_steps: number | null
          lora_url: string | null
          name: string
          prompt_system_message: string | null
          range_end_1: number | null
          range_end_2: number | null
          scene_duration_0to1: number | null
          scene_duration_1to3: number | null
          scene_duration_3plus: number | null
          style_reference_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          aspect_ratio?: string | null
          created_at?: string
          example_prompts?: Json | null
          id?: string
          image_height?: number | null
          image_model?: string | null
          image_width?: number | null
          lora_steps?: number | null
          lora_url?: string | null
          name: string
          prompt_system_message?: string | null
          range_end_1?: number | null
          range_end_2?: number | null
          scene_duration_0to1?: number | null
          scene_duration_1to3?: number | null
          scene_duration_3plus?: number | null
          style_reference_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          aspect_ratio?: string | null
          created_at?: string
          example_prompts?: Json | null
          id?: string
          image_height?: number | null
          image_model?: string | null
          image_width?: number | null
          lora_steps?: number | null
          lora_url?: string | null
          name?: string
          prompt_system_message?: string | null
          range_end_1?: number | null
          range_end_2?: number | null
          scene_duration_0to1?: number | null
          scene_duration_1to3?: number | null
          scene_duration_3plus?: number | null
          style_reference_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          aspect_ratio: string | null
          audio_url: string | null
          created_at: string
          example_prompts: Json | null
          id: string
          image_height: number | null
          image_model: string | null
          image_width: number | null
          lora_steps: number | null
          lora_url: string | null
          name: string
          prompt_system_message: string | null
          prompts: Json | null
          range_end_1: number | null
          range_end_2: number | null
          scene_duration_0to1: number | null
          scene_duration_1to3: number | null
          scene_duration_3plus: number | null
          scenes: Json | null
          style_reference_url: string | null
          summary: string | null
          thumbnail_preset_id: string | null
          transcript_json: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          aspect_ratio?: string | null
          audio_url?: string | null
          created_at?: string
          example_prompts?: Json | null
          id?: string
          image_height?: number | null
          image_model?: string | null
          image_width?: number | null
          lora_steps?: number | null
          lora_url?: string | null
          name: string
          prompt_system_message?: string | null
          prompts?: Json | null
          range_end_1?: number | null
          range_end_2?: number | null
          scene_duration_0to1?: number | null
          scene_duration_1to3?: number | null
          scene_duration_3plus?: number | null
          scenes?: Json | null
          style_reference_url?: string | null
          summary?: string | null
          thumbnail_preset_id?: string | null
          transcript_json?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          aspect_ratio?: string | null
          audio_url?: string | null
          created_at?: string
          example_prompts?: Json | null
          id?: string
          image_height?: number | null
          image_model?: string | null
          image_width?: number | null
          lora_steps?: number | null
          lora_url?: string | null
          name?: string
          prompt_system_message?: string | null
          prompts?: Json | null
          range_end_1?: number | null
          range_end_2?: number | null
          scene_duration_0to1?: number | null
          scene_duration_1to3?: number | null
          scene_duration_3plus?: number | null
          scenes?: Json | null
          style_reference_url?: string | null
          summary?: string | null
          thumbnail_preset_id?: string | null
          transcript_json?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_thumbnail_preset_id_fkey"
            columns: ["thumbnail_preset_id"]
            isOneToOne: false
            referencedRelation: "thumbnail_presets"
            referencedColumns: ["id"]
          },
        ]
      }
      script_presets: {
        Row: {
          created_at: string
          custom_prompt: string | null
          duration: string | null
          id: string
          language: string | null
          name: string
          style: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          custom_prompt?: string | null
          duration?: string | null
          id?: string
          language?: string | null
          name: string
          style?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          custom_prompt?: string | null
          duration?: string | null
          id?: string
          language?: string | null
          name?: string
          style?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      thumbnail_presets: {
        Row: {
          character_ref_url: string | null
          created_at: string
          custom_prompt: string | null
          example_urls: Json | null
          id: string
          image_model: string | null
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          character_ref_url?: string | null
          created_at?: string
          custom_prompt?: string | null
          example_urls?: Json | null
          id?: string
          image_model?: string | null
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          character_ref_url?: string | null
          created_at?: string
          custom_prompt?: string | null
          example_urls?: Json | null
          id?: string
          image_model?: string | null
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      title_presets: {
        Row: {
          created_at: string
          example_titles: Json
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          example_titles?: Json
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          example_titles?: Json
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tts_presets: {
        Row: {
          created_at: string
          emotion: string | null
          english_normalization: boolean | null
          id: string
          language_boost: string | null
          model: string | null
          name: string
          pitch: number | null
          provider: string
          speed: number | null
          updated_at: string
          user_id: string
          voice_id: string
          volume: number | null
        }
        Insert: {
          created_at?: string
          emotion?: string | null
          english_normalization?: boolean | null
          id?: string
          language_boost?: string | null
          model?: string | null
          name: string
          pitch?: number | null
          provider?: string
          speed?: number | null
          updated_at?: string
          user_id: string
          voice_id: string
          volume?: number | null
        }
        Update: {
          created_at?: string
          emotion?: string | null
          english_normalization?: boolean | null
          id?: string
          language_boost?: string | null
          model?: string | null
          name?: string
          pitch?: number | null
          provider?: string
          speed?: number | null
          updated_at?: string
          user_id?: string
          voice_id?: string
          volume?: number | null
        }
        Relationships: []
      }
      user_api_keys: {
        Row: {
          created_at: string | null
          eleven_labs_api_key: string | null
          export_base_path: string | null
          id: string
          replicate_api_key: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          eleven_labs_api_key?: string | null
          export_base_path?: string | null
          id?: string
          replicate_api_key?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          eleven_labs_api_key?: string | null
          export_base_path?: string | null
          id?: string
          replicate_api_key?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_user_api_key: { Args: { key_name: string }; Returns: boolean }
      get_user_api_key: { Args: { key_name: string }; Returns: string }
      get_user_api_key_for_service: {
        Args: { key_name: string; target_user_id: string }
        Returns: string
      }
      store_user_api_key: {
        Args: { key_name: string; key_value: string }
        Returns: string
      }
      update_scene_image_url: {
        Args: {
          p_image_url: string
          p_project_id: string
          p_scene_index: number
        }
        Returns: boolean
      }
    }
    Enums: {
      job_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
        | "cancelled"
      job_type:
        | "transcription"
        | "prompts"
        | "images"
        | "thumbnails"
        | "test_images"
        | "single_prompt"
        | "single_image"
        | "script_generation"
        | "audio_generation"
        | "full_video"
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
  public: {
    Enums: {
      job_status: ["pending", "processing", "completed", "failed", "cancelled"],
      job_type: [
        "transcription",
        "prompts",
        "images",
        "thumbnails",
        "test_images",
        "single_prompt",
        "single_image",
        "script_generation",
        "audio_generation",
        "full_video",
      ],
    },
  },
} as const
