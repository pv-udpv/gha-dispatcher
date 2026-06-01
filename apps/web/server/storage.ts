// This app persists to Supabase (see server/supabase.ts), not SQLite.
// The template's SQLite storage layer is intentionally unused.
export interface IStorage {}

export const storage: IStorage = {};
