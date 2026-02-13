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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          alert_type: Database["public"]["Enums"]["alert_type"]
          created_at: string
          device_id: string
          id: string
          is_read: boolean
          message: string | null
          title: string
        }
        Insert: {
          alert_type: Database["public"]["Enums"]["alert_type"]
          created_at?: string
          device_id: string
          id?: string
          is_read?: boolean
          message?: string | null
          title: string
        }
        Update: {
          alert_type?: Database["public"]["Enums"]["alert_type"]
          created_at?: string
          device_id?: string
          id?: string
          is_read?: boolean
          message?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      camera_captures: {
        Row: {
          captured_at: string
          command_id: string | null
          device_id: string
          id: string
          image_url: string
        }
        Insert: {
          captured_at?: string
          command_id?: string | null
          device_id: string
          id?: string
          image_url: string
        }
        Update: {
          captured_at?: string
          command_id?: string | null
          device_id?: string
          id?: string
          image_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "camera_captures_command_id_fkey"
            columns: ["command_id"]
            isOneToOne: false
            referencedRelation: "commands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "camera_captures_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      commands: {
        Row: {
          command_type: Database["public"]["Enums"]["command_type"]
          created_at: string
          device_id: string
          executed_at: string | null
          id: string
          payload: Json | null
          status: Database["public"]["Enums"]["command_status"]
        }
        Insert: {
          command_type: Database["public"]["Enums"]["command_type"]
          created_at?: string
          device_id: string
          executed_at?: string | null
          id?: string
          payload?: Json | null
          status?: Database["public"]["Enums"]["command_status"]
        }
        Update: {
          command_type?: Database["public"]["Enums"]["command_type"]
          created_at?: string
          device_id?: string
          executed_at?: string | null
          id?: string
          payload?: Json | null
          status?: Database["public"]["Enums"]["command_status"]
        }
        Relationships: [
          {
            foreignKeyName: "commands_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      device_locations: {
        Row: {
          city: string | null
          country: string | null
          device_id: string
          id: string
          ip_address: string | null
          latitude: number | null
          longitude: number | null
          recorded_at: string
        }
        Insert: {
          city?: string | null
          country?: string | null
          device_id: string
          id?: string
          ip_address?: string | null
          latitude?: number | null
          longitude?: number | null
          recorded_at?: string
        }
        Update: {
          city?: string | null
          country?: string | null
          device_id?: string
          id?: string
          ip_address?: string | null
          latitude?: number | null
          longitude?: number | null
          recorded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_locations_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      device_peripherals: {
        Row: {
          connected_at: string
          device_id: string
          disconnected_at: string | null
          id: string
          is_authorized: boolean
          name: string
          peripheral_type: Database["public"]["Enums"]["peripheral_type"]
          product_id: string | null
          status: Database["public"]["Enums"]["peripheral_status"]
          vendor_id: string | null
        }
        Insert: {
          connected_at?: string
          device_id: string
          disconnected_at?: string | null
          id?: string
          is_authorized?: boolean
          name: string
          peripheral_type: Database["public"]["Enums"]["peripheral_type"]
          product_id?: string | null
          status?: Database["public"]["Enums"]["peripheral_status"]
          vendor_id?: string | null
        }
        Update: {
          connected_at?: string
          device_id?: string
          disconnected_at?: string | null
          id?: string
          is_authorized?: boolean
          name?: string
          peripheral_type?: Database["public"]["Enums"]["peripheral_type"]
          product_id?: string | null
          status?: Database["public"]["Enums"]["peripheral_status"]
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_peripherals_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          battery_level: number | null
          created_at: string
          device_type: Database["public"]["Enums"]["device_type"]
          id: string
          ip_address: string | null
          is_camera_connected: boolean
          is_monitoring: boolean
          is_network_connected: boolean
          is_streaming_requested: boolean | null
          last_seen_at: string | null
          latitude: number | null
          location_updated_at: string | null
          longitude: number | null
          metadata: Json | null
          name: string
          status: Database["public"]["Enums"]["device_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          battery_level?: number | null
          created_at?: string
          device_type: Database["public"]["Enums"]["device_type"]
          id?: string
          ip_address?: string | null
          is_camera_connected?: boolean
          is_monitoring?: boolean
          is_network_connected?: boolean
          is_streaming_requested?: boolean | null
          last_seen_at?: string | null
          latitude?: number | null
          location_updated_at?: string | null
          longitude?: number | null
          metadata?: Json | null
          name: string
          status?: Database["public"]["Enums"]["device_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          battery_level?: number | null
          created_at?: string
          device_type?: Database["public"]["Enums"]["device_type"]
          id?: string
          ip_address?: string | null
          is_camera_connected?: boolean
          is_monitoring?: boolean
          is_network_connected?: boolean
          is_streaming_requested?: boolean | null
          last_seen_at?: string | null
          latitude?: number | null
          location_updated_at?: string | null
          longitude?: number | null
          metadata?: Json | null
          name?: string
          status?: Database["public"]["Enums"]["device_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      licenses: {
        Row: {
          created_at: string
          device_id: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          serial_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          serial_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          serial_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "licenses_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          device_id: string | null
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          device_id?: string | null
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          device_id?: string | null
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          created_at: string
          key: string
          value: Json
        }
        Insert: {
          created_at?: string
          key: string
          value: Json
        }
        Update: {
          created_at?: string
          key?: string
          value?: Json
        }
        Relationships: []
      }
      webrtc_signaling: {
        Row: {
          created_at: string
          data: Json
          device_id: string
          expires_at: string
          id: string
          sender_type: string
          session_id: string
          type: string
        }
        Insert: {
          created_at?: string
          data: Json
          device_id: string
          expires_at?: string
          id?: string
          sender_type: string
          session_id: string
          type: string
        }
        Update: {
          created_at?: string
          data?: Json
          device_id?: string
          expires_at?: string
          id?: string
          sender_type?: string
          session_id?: string
          type?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_expired_signaling: { Args: never; Returns: undefined }
      generate_serial_key: { Args: never; Returns: string }
    }
    Enums: {
      alert_type:
        | "intrusion"
        | "unauthorized_peripheral"
        | "location_change"
        | "offline"
        | "low_battery"
      command_status: "pending" | "sent" | "executed" | "failed"
      command_type: "alarm" | "camera_capture" | "lock" | "locate" | "message"
      device_status: "online" | "offline" | "monitoring" | "alert"
      device_type: "laptop" | "desktop" | "smartphone" | "tablet"
      peripheral_status: "connected" | "disconnected" | "unauthorized"
      peripheral_type:
        | "usb"
        | "keyboard"
        | "mouse"
        | "microphone"
        | "camera"
        | "network"
        | "bluetooth"
        | "other"
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
      alert_type: [
        "intrusion",
        "unauthorized_peripheral",
        "location_change",
        "offline",
        "low_battery",
      ],
      command_status: ["pending", "sent", "executed", "failed"],
      command_type: ["alarm", "camera_capture", "lock", "locate", "message"],
      device_status: ["online", "offline", "monitoring", "alert"],
      device_type: ["laptop", "desktop", "smartphone", "tablet"],
      peripheral_status: ["connected", "disconnected", "unauthorized"],
      peripheral_type: [
        "usb",
        "keyboard",
        "mouse",
        "microphone",
        "camera",
        "network",
        "bluetooth",
        "other",
      ],
    },
  },
} as const
