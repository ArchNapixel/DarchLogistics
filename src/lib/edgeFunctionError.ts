// edgeFunctionError: supabase-js's functions.invoke() doesn't surface
// the JSON body an Edge Function sends back on a non-2xx response -- it
// just gives a generic "Edge Function returned a non-2xx status code"
// message, with the actual Response object tucked away on
// error.context. This pulls the real { error: "..." } message back out
// of that Response instead of showing the useless generic one.
export async function extractEdgeFunctionErrorMessage(
  invokeError: unknown,
  fallbackMessage: string,
): Promise<string> {
  const context = (invokeError as { context?: unknown } | null)?.context

  if (context instanceof Response) {
    try {
      const body = await context.json()
      if (body?.error) {
        return body.error
      }
    } catch {
      // Body wasn't JSON, or was already consumed -- fall through to the
      // generic message below instead of throwing.
    }
  }

  if (invokeError instanceof Error) {
    return invokeError.message
  }

  return fallbackMessage
}
