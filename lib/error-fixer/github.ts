import { Octokit } from '@octokit/rest';
import { prisma } from '@/lib/db';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER = process.env.GITHUB_REPO_OWNER || '';
const REPO = process.env.GITHUB_REPO_NAME || '';
const BASE_BRANCH = process.env.GITHUB_BASE_BRANCH || 'main';

let cachedClient: Octokit | null = null;

function client(): Octokit {
  if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not configured');
  if (!OWNER || !REPO) throw new Error('GITHUB_REPO_OWNER and GITHUB_REPO_NAME must be configured');
  if (!cachedClient) {
    cachedClient = new Octokit({ auth: GITHUB_TOKEN });
  }
  return cachedClient;
}

export interface CommittedFile {
  path: string;       // repo-relative
  contents: string;
}

export interface BranchResult {
  branchName: string;
  commitSha: string;
  prUrl?: string;
}

/**
 * Allocate the next sequential branch name for today. Looks at existing
 * ErrorAutoFix.branchName rows for today and picks the next number.
 * Pattern: error/YYYYMMDD-N
 */
export async function allocateBranchName(now = new Date()): Promise<string> {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const datePart = `${yyyy}${mm}${dd}`;
  const prefix = `error/${datePart}-`;

  const existing = await prisma.errorAutoFix.findMany({
    where: { branchName: { startsWith: prefix } },
    select: { branchName: true },
  });

  let max = 0;
  for (const r of existing) {
    const n = parseInt((r.branchName ?? '').slice(prefix.length), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `${prefix}${max + 1}`;
}

/**
 * Create a branch from BASE_BRANCH. If the branch already exists, returns
 * its current head SHA without re-creating.
 */
export async function createBranch(branchName: string): Promise<string> {
  const gh = client();

  // Get base branch SHA
  const baseRef = await gh.git.getRef({ owner: OWNER, repo: REPO, ref: `heads/${BASE_BRANCH}` });
  const baseSha = baseRef.data.object.sha;

  try {
    await gh.git.createRef({
      owner: OWNER,
      repo: REPO,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });
  } catch (e: unknown) {
    // 422 = already exists; treat as success
    const status = (e as { status?: number }).status;
    if (status !== 422) throw e;
  }
  return baseSha;
}

/**
 * Commit a set of file changes to a branch in a single tree.
 * Uses the Git Data API so multiple files become a single commit.
 */
export async function commitFiles(opts: {
  branch: string;
  files: CommittedFile[];
  message: string;
}): Promise<{ commitSha: string }> {
  const gh = client();
  const { branch, files, message } = opts;

  // 1. Get current head of branch
  const ref = await gh.git.getRef({ owner: OWNER, repo: REPO, ref: `heads/${branch}` });
  const headSha = ref.data.object.sha;

  // 2. Get the tree of HEAD
  const headCommit = await gh.git.getCommit({ owner: OWNER, repo: REPO, commit_sha: headSha });
  const baseTreeSha = headCommit.data.tree.sha;

  // 3. Create blobs for each file
  const blobShas = await Promise.all(
    files.map(async (f) => {
      const blob = await gh.git.createBlob({
        owner: OWNER,
        repo: REPO,
        content: Buffer.from(f.contents, 'utf8').toString('base64'),
        encoding: 'base64',
      });
      return { path: f.path, sha: blob.data.sha };
    })
  );

  // 4. Build a new tree
  const tree = await gh.git.createTree({
    owner: OWNER,
    repo: REPO,
    base_tree: baseTreeSha,
    tree: blobShas.map((b) => ({
      path: b.path,
      mode: '100644' as const,
      type: 'blob' as const,
      sha: b.sha,
    })),
  });

  // 5. Create commit
  const commit = await gh.git.createCommit({
    owner: OWNER,
    repo: REPO,
    message,
    tree: tree.data.sha,
    parents: [headSha],
  });

  // 6. Update branch ref
  await gh.git.updateRef({
    owner: OWNER,
    repo: REPO,
    ref: `heads/${branch}`,
    sha: commit.data.sha,
  });

  return { commitSha: commit.data.sha };
}

/**
 * Merge a branch into BASE_BRANCH using the GitHub merge API. Returns the
 * merge commit SHA.
 */
export async function mergeBranchToBase(branch: string, message?: string): Promise<{ mergeSha: string }> {
  const gh = client();
  const res = await gh.repos.merge({
    owner: OWNER,
    repo: REPO,
    base: BASE_BRANCH,
    head: branch,
    commit_message: message,
  });
  // 201 = merged, 204 = nothing to merge, 409 = conflict
  if (!res.data?.sha) throw new Error('Merge returned no SHA');
  return { mergeSha: res.data.sha };
}

/**
 * Revert a commit on the BASE_BRANCH by creating a new commit that inverts it.
 * GitHub doesn't have a native revert API, so we build it manually:
 *   - Get the parent tree of the commit to revert
 *   - Create a new commit on BASE_BRANCH whose tree matches the parent
 * Note: this is a "hard revert" — anything committed AFTER the bad commit will
 * also be lost. Suitable for the auto-fix flow because fixes are atomic.
 */
export async function revertCommit(commitSha: string): Promise<{ revertSha: string }> {
  const gh = client();

  const target = await gh.git.getCommit({ owner: OWNER, repo: REPO, commit_sha: commitSha });
  if (!target.data.parents || target.data.parents.length === 0) {
    throw new Error(`Commit ${commitSha} has no parent — cannot revert`);
  }
  const parentSha = target.data.parents[0].sha;
  const parentCommit = await gh.git.getCommit({ owner: OWNER, repo: REPO, commit_sha: parentSha });
  const parentTreeSha = parentCommit.data.tree.sha;

  // Get current head of base
  const ref = await gh.git.getRef({ owner: OWNER, repo: REPO, ref: `heads/${BASE_BRANCH}` });
  const headSha = ref.data.object.sha;

  const revertCommit = await gh.git.createCommit({
    owner: OWNER,
    repo: REPO,
    message: `Revert "${target.data.message.split('\n')[0]}"\n\nReverts commit ${commitSha}.`,
    tree: parentTreeSha,
    parents: [headSha],
  });

  await gh.git.updateRef({
    owner: OWNER,
    repo: REPO,
    ref: `heads/${BASE_BRANCH}`,
    sha: revertCommit.data.sha,
  });

  return { revertSha: revertCommit.data.sha };
}

export function getRepoConfig() {
  return { owner: OWNER, repo: REPO, baseBranch: BASE_BRANCH };
}

export function isGitHubConfigured(): boolean {
  return Boolean(GITHUB_TOKEN && OWNER && REPO);
}

export function branchUrl(branchName: string): string {
  return `https://github.com/${OWNER}/${REPO}/tree/${encodeURIComponent(branchName)}`;
}

export function commitUrl(sha: string): string {
  return `https://github.com/${OWNER}/${REPO}/commit/${sha}`;
}

export function compareUrl(branchName: string): string {
  return `https://github.com/${OWNER}/${REPO}/compare/${BASE_BRANCH}...${encodeURIComponent(branchName)}`;
}
