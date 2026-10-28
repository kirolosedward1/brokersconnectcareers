import 'server-only';
import { connection } from 'next/server';
import { logFailure } from '@/lib/observe';
import { createPublicClient } from '@/lib/supabase/public';
import { optional } from './error';
import { getBrowseCounts } from './browse';

/**
 * What the auth panel may say about the market.
 *
 * Both figures are read as an anonymous visitor would see them, and either
 * one is null when the read failed or came back empty. A trust line that
 * says zero, or that invents a number because the database was down, is
 * worse than saying nothing — the panel then uses the app's real
 * coming-soon line instead.
 *
 * `connection()` keeps the figure on the request. Without it a static auth
 * screen would bake whatever the build machine could see, and a build with
 * no database would freeze "coming soon" into the HTML forever.
 */
export type MarketProof = {
  /** Live listings on the board. */
  jobs: number | null;
  /** Verified companies that are not suspended and not our own test rows. */
  companies: number | null;
};

export async function getMarketProof(): Promise<MarketProof> {
  await connection();

  const [browse, companies] = await Promise.all([
    optional(getBrowseCounts(), null),
    countVerifiedCompanies(),
  ]);

  const jobs = browse && browse.total > 0 ? browse.total : null;
  return {
    jobs,
    companies: companies != null && companies > 0 ? companies : null,
  };
}

async function countVerifiedCompanies(): Promise<number | null> {
  try {
    const supabase = createPublicClient();

    /*
      Test rows and suspended firms are not a public claim. Both columns
      arrived in later migrations, and code reaches production before a
      migration as often as after — a missing column is the looser count,
      not a panel that hides a real number.
    */
    const strict = await supabase
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .eq('verification_status', 'verified')
      .eq('is_test', false)
      .is('suspended_at', null);

    /*
      A missing column comes back as 42703, and sometimes as a 400 whose
      code the client does not surface. Either way the looser count — every
      verified company — is still a real figure, and still not invented.
    */
    const result = strict.error
      ? await supabase
          .from('companies')
          .select('id', { count: 'exact', head: true })
          .eq('verification_status', 'verified')
      : strict;

    if (result.error) {
      logFailure('auth', 'could not count verified companies', { code: result.error.code ?? 'unknown' });
      return null;
    }
    return result.count ?? null;
  } catch (error) {
    logFailure('auth', 'could not count verified companies', {
      code: error instanceof Error ? error.name : 'throw',
    });
    return null;
  }
}
