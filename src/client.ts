/** Error from the Nijam API, carrying its envelope `code` + HTTP status. */
export class NijamApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'NijamApiError';
  }
}

type Query = Record<string, string | number | undefined>;

/** Minimal read-only client for the Nijam API (Bearer secret key, JSON only). */
export class NijamClient {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
  ) {}

  async get<T>(path: string, query?: Query): Promise<T> {
    const url = new URL(path, this.apiUrl);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const fallback = `Nijam API request failed (${res.status})`;
      let message = fallback;
      let code = 'HTTP_ERROR';
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        message = body.error?.message ?? fallback;
        code = body.error?.code ?? code;
      } catch {
        // non-JSON error body — keep the fallback
      }
      throw new NijamApiError(message, code, res.status);
    }

    return (await res.json()) as T;
  }
}
