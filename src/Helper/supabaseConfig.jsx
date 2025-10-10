import { createClient } from "@supabase/supabase-js";

const SupabaseUrl = "https://bfxmfaakufrmzcxhtgfw.supabase.co";
const SupbaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmeG1mYWFrdWZybXpjeGh0Z2Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4MTQzMTIsImV4cCI6MjA3NTM5MDMxMn0.qtNn0qXNhn8ol8fTSb2Hp9nQkYfFA2Y_Zec4LuISPZQ";

const supabase = createClient(SupabaseUrl, SupbaseAnonKey);

export default supabase;
