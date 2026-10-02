// update-user-account: Admin-only Edge Function that changes the email,
// username and/or password of an EXISTING employee login (the one made by
// create-user-account). Same reason as that function: changing another
// person's Auth email/password needs the service-role key, which must stay
// on the server. Only fields that are sent get changed.
//
// Admin only (not Dispatcher) -- otherwise a Dispatcher could reset an
// Admin's password and take over their account.
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { employee_id, email, username, password } = await req.json();

    if (!employee_id) {
      return jsonResponse({ error: "Missing employee_id." }, 400);
    }
    if (password && String(password).length < 6) {
      return jsonResponse({ error: "Password must be at least 6 characters." }, 400);
    }

    const authHeader = req.headers.get("Authorization");
    const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) {
      return jsonResponse({ error: "Not authenticated." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Only used to find out who's calling.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerAuth, error: callerAuthError } =
      await callerClient.auth.getUser(accessToken);
    if (callerAuthError || !callerAuth.user) {
      return jsonResponse({ error: "Not authenticated." }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerRow } = await adminClient
      .from("users")
      .select("user_role")
      .eq("auth_user_id", callerAuth.user.id)
      .single();
    if (callerRow?.user_role !== "Admin") {
      return jsonResponse({ error: "Only an Admin can change account details." }, 403);
    }

    const { data: target } = await adminClient
      .from("users")
      .select("user_id, auth_user_id")
      .eq("employee_id", employee_id)
      .single();
    if (!target) {
      return jsonResponse({ error: "This employee has no account yet." }, 404);
    }

    const userUpdate: Record<string, string> = {};

    if (username !== undefined) {
      const cleanUsername = String(username).trim();
      if (!cleanUsername || cleanUsername.includes("@")) {
        return jsonResponse({ error: "Username can't be empty or contain '@'." }, 400);
      }
      const { data: taken } = await adminClient
        .from("users")
        .select("user_id")
        .ilike("username", cleanUsername.replace(/[\\%_]/g, "\\$&"))
        .neq("user_id", target.user_id)
        .limit(1);
      if (taken && taken.length > 0) {
        return jsonResponse({ error: "That username is already taken." }, 400);
      }
      userUpdate.username = cleanUsername;
    }

    // Auth first (it can reject a duplicate email); the users row only
    // follows if that worked, so the two don't drift apart.
    const authUpdate: Record<string, unknown> = {};
    if (email) {
      authUpdate.email = email;
      authUpdate.email_confirm = true;
      userUpdate.email = email;
    }
    if (password) authUpdate.password = password;

    if (Object.keys(authUpdate).length > 0) {
      const { error: authError } = await adminClient.auth.admin.updateUserById(
        target.auth_user_id,
        authUpdate,
      );
      if (authError) return jsonResponse({ error: authError.message }, 400);
    }

    if (Object.keys(userUpdate).length > 0) {
      const { error: updateError } = await adminClient
        .from("users")
        .update(userUpdate)
        .eq("user_id", target.user_id);
      if (updateError) return jsonResponse({ error: updateError.message }, 400);
    }

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
