// create-user-account: staff-only Edge Function that creates a REAL
// Supabase Auth login (email + password) for a client or employee, and
// links it to a `public.users` row immediately.
//
// This has to run server-side because creating another person's Auth
// account requires the service-role key -- a credential with full admin
// access to the whole project, which must never be sent to the browser.
// The browser only ever sends its own normal session token; this
// function does the privileged work using its own admin client.
//
// Security: before doing anything, this checks that the CALLER (whoever
// is invoking this function right now) is logged in AND has a staff
// role (Admin/Dispatcher) in `public.users`. Without that check, anyone
// with a valid login -- a Driver, a Client -- could call this function
// to create arbitrary new accounts.
import { createClient } from "@supabase/supabase-js";

// The browser (a different origin than this function) sends a CORS
// preflight OPTIONS request before the real POST -- without these
// headers, the browser blocks the request before it ever reaches the
// code below, which shows up client-side as a generic
// "Failed to send a request to the Edge Function".
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
    const { email, username, password, user_role, client_id, employee_id } =
      await req.json();

    if (!email || !username || !password || !user_role) {
      return jsonResponse({ error: "Missing required fields." }, 400);
    }
    if (!client_id && !employee_id) {
      return jsonResponse(
        { error: "Provide either a client_id or an employee_id." },
        400,
      );
    }

    const authHeader = req.headers.get("Authorization");
    const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) {
      return jsonResponse({ error: "Not authenticated." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Scoped to the caller's own session -- only used to find out who's
    // calling, never for privileged work.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerAuth, error: callerAuthError } =
      await callerClient.auth.getUser(accessToken);

    if (callerAuthError || !callerAuth.user) {
      return jsonResponse({ error: "Not authenticated." }, 401);
    }

    // Service-role client: bypasses RLS, used only for the two
    // privileged steps below (checking the caller's role, and creating
    // the new account).
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerRow, error: callerRowError } = await adminClient
      .from("users")
      .select("user_role")
      .eq("auth_user_id", callerAuth.user.id)
      .single();

    if (
      callerRowError || !callerRow ||
      !["Admin", "Dispatcher"].includes(callerRow.user_role)
    ) {
      return jsonResponse({ error: "Only staff can set up accounts." }, 403);
    }

    const { data: newAuthUser, error: createAuthError } = await adminClient
      .auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (createAuthError || !newAuthUser.user) {
      return jsonResponse(
        { error: createAuthError?.message ?? "Could not create login." },
        400,
      );
    }

    const { error: insertError } = await adminClient.from("users").insert({
      email,
      username,
      user_role,
      client_id: client_id ?? null,
      employee_id: employee_id ?? null,
      auth_user_id: newAuthUser.user.id,
    });

    if (insertError) {
      // The Auth account was created but the users row failed -- clean
      // up so a retry doesn't hit "email already registered".
      await adminClient.auth.admin.deleteUser(newAuthUser.user.id);
      return jsonResponse({ error: insertError.message }, 400);
    }

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
