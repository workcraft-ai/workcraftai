import type { SupabaseClient } from "@supabase/supabase-js";
export function isDeletedSubscriptionOwner(admin: SupabaseClient, userId: string, error: unknown): Promise<boolean>;
