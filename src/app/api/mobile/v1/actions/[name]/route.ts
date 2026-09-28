import type { NextRequest } from 'next/server';
import { logFailure } from '@/lib/observe';
import { mobileJson, readActionInput, unauthorized, withMobileAuth } from '@/lib/mobile-api/http';
import { REGISTRY, isActionName, isMultipartAction, isPublicAction } from '@/lib/mobile-api/registry';

/**
 * POST /api/mobile/v1/actions/<name> — the mobile app's one door for writes.
 *
 * Runs the named server action as the bearer token's user (see registry.ts for
 * which exist and contract.ts for their shapes). The action's own answer comes
 * back with HTTP 200 whatever it says; a non-200 means the request never got
 * as far as the action.
 */
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ name: string }> };

export const POST = withMobileAuth<Context>(
  async (request: NextRequest, { params }, session) => {
    const { name } = await params;
    if (!isActionName(name)) return mobileJson({ error: 'unknown_action' }, { status: 404 });

    // The door lets a signed-out caller in so the four signed-out actions can
    // run; everything else is refused here, before the action is reached.
    if (!session && !isPublicAction(name)) return unauthorized('unauthenticated');

    const input = await readActionInput(request, isMultipartAction(name) ? 'multipart' : 'json');
    if ('refused' in input) return input.refused;

    try {
      const result = await REGISTRY[name].run(input.value);
      return mobileJson(result);
    } catch (error) {
      logFailure('mobile-api', 'an action threw', {
        action: name,
        detail: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
      });
      return mobileJson({ error: 'failed' }, { status: 500 });
    }
  },
  { optional: true },
);
