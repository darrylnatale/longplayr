import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { countRows, COUNT_ONLY } from '../count';
import { getCurrentProfile } from '../profiles';

/**
 * What a moderated person is told, and nothing else.
 *
 * **This is the other side of `src/services/admin/`.** That module writes a
 * moderation action; this one is the only way the affected person reads it.
 * DSA Art 17 requires that they are told why, so a record they cannot reach
 * does not discharge it — `architecture.md` §16.10.
 *
 * **The acting administrator is never returned from here, and the column grant
 * is what enforces that rather than this file** (§16.10e). `authenticated` has
 * `select` on nine columns and `actor_id` is not among them, so a hand-written
 * query cannot reach it either. **RLS answers which rows; grants answer which
 * columns** — the lesson §92 and §94 each paid for.
 *
 * **Reads go through the request-scoped client so RLS applies.** The policy
 * scopes rows to `subject_user_id = auth.uid()`, which is the whole access
 * rule. Only the acknowledgement write uses the service-role client, because
 * `authenticated` deliberately holds no UPDATE on a legal record.
 */

export type Statement = {
  id: string;
  kind: 'content_removed' | 'content_restored' | 'account_suspended' | 'account_reinstated';
  /** What was acted on, snapshotted at the time, so it survives the content. */
  subject: string;
  ground: string;
  /** Null only on a restoration, which owes no statement. */
  statement: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
};

const COLUMNS = 'id, kind, subject_label, ground, statement, created_at, acknowledged_at' as const;

/** Every statement addressed to the signed-in person, newest first. */
export async function listOwnStatements(): Promise<Statement[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('moderation_actions')
    .select(COLUMNS)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    subject: row.subject_label,
    ground: row.ground,
    statement: row.statement,
    createdAt: row.created_at,
    acknowledgedAt: row.acknowledged_at,
  }));
}

/**
 * How many statements the person has not yet seen.
 *
 * **Goes through `countRows`**, which §16.2 requires and a lint rule enforces:
 * a raw `head: true` count reports a confident zero for a relation the database
 * could not resolve, and a silent zero here means somebody is never told their
 * content was removed.
 *
 * Returns 0 for a signed-out visitor without querying.
 */
export async function unacknowledgedStatementCount(): Promise<number> {
  const profile = await getCurrentProfile();
  if (!profile) return 0;

  const supabase = await createClient();

  return countRows(
    supabase.from('moderation_actions').select('id', COUNT_ONLY).is('acknowledged_at', null),
    'moderation_actions.unacknowledged',
  );
}

/**
 * Marks every statement addressed to the signed-in person as seen.
 *
 * **Uses the service-role client, and that is the point rather than a
 * shortcut.** `authenticated` has no UPDATE on `moderation_actions` at all —
 * not even on `acknowledged_at`. A retained legal record is not somewhere to
 * open a write surface for the convenience of a badge, and §94 found that a
 * single-column grant is harder to get right than it looks.
 *
 * **Scoped here by `subject_user_id`, explicitly.** The service-role client
 * bypasses RLS, so this filter is the access rule rather than a narrowing of
 * one — getting it wrong would let anyone's visit clear everyone's badge.
 */
export async function acknowledgeOwnStatements(): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) return;

  const admin = createAdminClient();
  const { error } = await admin
    .from('moderation_actions')
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('subject_user_id', profile.id)
    .is('acknowledged_at', null);

  if (error) throw error;
}
