import type { NijamClient } from './client.js';
import type { ApiProject } from './types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Slug of a project name, what an AI naturally types for "Web Checkout"
 * (`web-checkout`). Projects have no stored slug; this derivation IS the slug
 * contract, shared by get_projects (output) and the resolver (input).
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '') // strip diacritics decomposed by NFKD
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface ProjectRef {
  id: string;
  slug: string;
  name: string;
}

/** Cache the project list briefly, every tool resolves through it. */
const CACHE_TTL_MS = 60_000;
let cache: { at: number; projects: ApiProject[] } | null = null;

export async function listProjects(client: NijamClient): Promise<ApiProject[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.projects;
  const { projects } = await client.get<{ projects: ApiProject[] }>('/v1/projects');
  cache = { at: Date.now(), projects };
  return projects;
}

/**
 * Resolve a project reference, UUID, slug, or name, to its id.
 * Throws with an actionable message (listing what IS available) on miss or
 * ambiguity, so the model can self-correct without another round trip.
 */
export async function resolveProjectId(client: NijamClient, ref: string): Promise<string> {
  const trimmed = ref.trim();
  if (UUID_RE.test(trimmed)) return trimmed;

  const projects = await listProjects(client);
  const wanted = slugify(trimmed);
  const matches = projects.filter((p) => slugify(p.name) === wanted);

  if (matches.length === 1) return matches[0]!.id;
  if (matches.length > 1) {
    const candidates = matches.map((p) => `"${p.name}" (${p.id})`).join(', ');
    throw new Error(
      `Project "${ref}" is ambiguous, ${matches.length} projects share that slug: ${candidates}. Pass the id instead.`,
    );
  }

  const available = projects.map((p) => slugify(p.name)).join(', ') || '(none)';
  throw new Error(
    `No project matches "${ref}". Available project slugs: ${available}. Call get_projects to list them with ids.`,
  );
}
