import { AgentActionContext } from '../ToolRegistry';
import { useUiStore } from '../../../integration/store/uiStore';

function parseRepo(repo: string): { owner: string; name: string } | null {
  const normalized = repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
  const [owner, name] = normalized.split('/').filter(Boolean);
  if (!owner || !name) return null;
  return { owner, name };
}

function toBase64Utf8(input: string): string {
  return btoa(unescape(encodeURIComponent(input)));
}

function isSafePath(path: string): boolean {
  if (!path) return false;
  if (path.startsWith('/')) return false;
  if (path.includes('..')) return false;
  if (path.startsWith('.git')) return false;
  if (path.includes('/.git')) return false;
  return true;
}

async function githubRequest(url: string, token: string, options: RequestInit = {}) {
  const resp = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const msg = (json?.message ? String(json.message) : `GitHub error (HTTP ${resp.status})`).trim();
    throw new Error(msg);
  }
  return json;
}

export async function githubCreatePullRequest(
  agent: AgentActionContext,
  args: {
    title: string;
    body?: string;
    baseBranch?: string;
    branchName?: string;
    files: Array<{ path: string; content: string }>;
    commitMessage?: string;
  }
): Promise<boolean> {
  const cfg = useUiStore.getState().githubConfig;
  if (!cfg?.token || !cfg?.repo) {
    agent.appendHistory({
      role: 'assistant',
      content: 'GitHub is not connected. Open the GitHub button in the header and save your repo + token first.'
    });
    return false;
  }

  const repoInfo = parseRepo(cfg.repo);
  if (!repoInfo) {
    agent.appendHistory({
      role: 'assistant',
      content: 'GitHub repo format is invalid. Use owner/repo.'
    });
    return false;
  }

  const title = String(args.title || '').trim();
  if (!title) {
    agent.appendHistory({ role: 'assistant', content: 'Missing PR title.' });
    return false;
  }

  const files = Array.isArray(args.files) ? args.files : [];
  if (files.length === 0) {
    agent.appendHistory({ role: 'assistant', content: 'No files provided for PR.' });
    return false;
  }

  for (const f of files) {
    if (!isSafePath(String(f?.path || ''))) {
      agent.appendHistory({ role: 'assistant', content: `Unsafe path blocked: ${String(f?.path || '')}` });
      return false;
    }
  }

  const token = cfg.token.trim();
  const baseBranch = (args.baseBranch || cfg.baseBranch || 'main').trim() || 'main';
  const branchName = (args.branchName || `agent/${Date.now()}-${Math.random().toString(36).slice(2, 7)}`).trim();
  const commitMessage = (args.commitMessage || `Agent update: ${title}`).trim();
  const body = (args.body || '').trim();

  const { owner, name } = repoInfo;
  const apiBase = `https://api.github.com/repos/${owner}/${name}`;

  try {
    const ref = await githubRequest(`${apiBase}/git/ref/heads/${encodeURIComponent(baseBranch)}`, token);
    const sha = String(ref?.object?.sha || '');
    if (!sha) throw new Error('Failed to resolve base branch SHA.');

    await githubRequest(`${apiBase}/git/refs`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha,
      }),
    });

    for (const f of files) {
      const path = String(f.path);
      const content = String(f.content ?? '');
      const encodedPath = encodeURI(path).replace(/\+/g, '%20');
      let existingSha: string | undefined;
      try {
        const existing = await githubRequest(`${apiBase}/contents/${encodedPath}?ref=${encodeURIComponent(branchName)}`, token);
        if (existing && typeof existing.sha === 'string') existingSha = existing.sha;
      } catch { }

      await githubRequest(`${apiBase}/contents/${encodedPath}`, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: commitMessage,
          content: toBase64Utf8(content),
          branch: branchName,
          ...(existingSha ? { sha: existingSha } : {}),
        }),
      });
    }

    const pr = await githubRequest(`${apiBase}/pulls`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        head: branchName,
        base: baseBranch,
        body: body || undefined,
      }),
    });

    const url = String(pr?.html_url || '');
    agent.appendHistory({
      role: 'assistant',
      content: url ? `GitHub PR created: ${url}` : 'GitHub PR created.'
    });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    agent.appendHistory({
      role: 'assistant',
      content: `GitHub PR failed: ${msg}`
    });
    return false;
  }
}
