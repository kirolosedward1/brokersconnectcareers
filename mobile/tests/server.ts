/**
 * A stand-in for the network: the website's /api/mobile/v1 and Supabase's
 * REST endpoint, answered from fixtures. Tests register what each path
 * answers; anything unregistered is a 404, and every request is recorded so a
 * test can say what the app asked for.
 */
type Handler = (url: URL, init: RequestInit | undefined) => { status?: number; body: unknown } | unknown;

export type Request = { method: string; url: URL; body: unknown };

export function fakeServer() {
  const routes = new Map<string, Handler>();
  const requests: Request[] = [];

  const fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = init?.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // Not JSON: kept as sent.
      }
    }
    requests.push({ method, url, body });

    const handler = routes.get(`${method} ${url.pathname}`) ?? routes.get(url.pathname);
    if (!handler) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    const answer = handler(url, init);
    const { status, body: payload } =
      answer && typeof answer === 'object' && 'body' in answer
        ? (answer as { status?: number; body: unknown })
        : { status: 200, body: answer };
    return new Response(JSON.stringify(payload), {
      status: status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  return {
    fetch,
    requests,
    /** `path` or `METHOD path`, answered with a fixture or a function of the request. */
    on(route: string, handler: Handler | object) {
      routes.set(route, typeof handler === 'function' ? (handler as Handler) : () => handler);
    },
    asked(pathname: string) {
      return requests.filter((request) => request.url.pathname === pathname);
    },
  };
}
