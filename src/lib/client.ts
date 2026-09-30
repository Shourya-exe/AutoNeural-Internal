/** Browser-side API helper shared by the workspace screens. */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Options = {
  method?: string;
  /** JSON body. */
  body?: unknown;
  /** Multipart body (file uploads). */
  form?: FormData;
  /** Don't send the user to the sign-in page on 401 (the sign-in form itself). */
  noRedirect?: boolean;
};

/** A same-site path to return to after signing in; anything else falls back to "/". */
export function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export async function api<T = any>(path: string, opts: Options = {}): Promise<T> {
  const hasBody = opts.body !== undefined || opts.form !== undefined;
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (hasBody ? "POST" : "GET"),
      headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // A proxy error page or similar; handled below by status.
  }
  if (res.status === 401 && !opts.noRedirect) {
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    throw new ApiError(401, "Your session has ended. Please sign in again.");
  }
  if (!res.ok) {
    const fallback =
      res.status === 413
        ? "That upload is too large."
        : res.status >= 500
          ? "The server had a problem. Please try again in a moment."
          : `The request failed (${res.status}).`;
    throw new ApiError(res.status, data?.error || fallback);
  }
  return data as T;
}
