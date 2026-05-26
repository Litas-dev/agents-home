import { AgentActionContext } from '../ToolRegistry';
import { useUiStore } from '../../../integration/store/uiStore';
import { useCoreStore } from '../../../integration/store/coreStore';

function parseRepo(repo: string): { owner: string; name: string } | null {
  const normalized = repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
  const [owner, name] = normalized.split('/').filter(Boolean);
  if (!owner || !name) return null;
  return { owner, name };
}

function toBase64Utf8(input: string): string {
  return btoa(unescape(encodeURIComponent(input)));
}

function fromBase64Utf8(b64: string): string {
  return decodeURIComponent(escape(atob(b64)));
}

function isSafePath(path: string): boolean {
  if (!path) return false;
  if (path.startsWith('/')) return false;
  if (path.includes('..')) return false;
  if (path.startsWith('.git')) return false;
  if (path.includes('/.git')) return false;
  return true;
}

function userExplicitlyRequestedShare(agentIndex: number): boolean {
  const history = useCoreStore.getState().agentHistories[agentIndex] || [];
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m?.role !== 'user') continue;
    if (m?.metadata?.internal) continue;
    const text = String(m?.content || '').toLowerCase();
    if (!text) return false;
    return (
      text.includes('show') ||
      text.includes('print') ||
      text.includes('paste') ||
      text.includes('display') ||
      text.includes('dump') ||
      text.includes('full') ||
      text.includes('contents') ||
      text.includes('content') ||
      text.includes('tree') ||
      text.includes('list files') ||
      text.includes('list repo') ||
      text.includes('read file')
    );
  }
  return false;
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

export async function githubReadFile(
  agent: AgentActionContext,
  args: { path: string; ref?: string; maxChars?: number; shareWithUser?: boolean }
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
    agent.appendHistory({ role: 'assistant', content: 'GitHub repo format is invalid. Use owner/repo.' });
    return false;
  }

  const path = String(args?.path || '').trim();
  if (!isSafePath(path)) {
    agent.appendHistory({ role: 'assistant', content: `Unsafe path blocked: ${path}` });
    return false;
  }

  const token = cfg.token.trim();
  const ref = String(args?.ref || cfg.baseBranch || 'main').trim() || 'main';
  const maxChars = Math.max(1000, Math.min(200000, Number(args?.maxChars ?? 20000)));
  const shareWithUser = Boolean(args?.shareWithUser) && userExplicitlyRequestedShare(agent.data.index);
  const { owner, name } = repoInfo;
  const apiBase = `https://api.github.com/repos/${owner}/${name}`;

  try {
    const encodedPath = encodeURI(path).replace(/\+/g, '%20');
    const res = await githubRequest(`${apiBase}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`, token);

    if (Array.isArray(res)) {
      const lines = res
        .map((e: any) => {
          const type = String(e?.type || '');
          const p = String(e?.path || '');
          return `- ${type}: ${p}`;
        })
        .slice(0, 200)
        .join('\n');

      agent.appendHistory({
        role: 'assistant',
        content: `GitHub path is a directory: ${path} @ ${ref}\n${lines || '(empty)'}`,
        metadata: shareWithUser ? undefined : { internal: true }
      });
      return true;
    }

    const encoding = String(res?.encoding || '');
    const contentB64 = String(res?.content || '').replace(/\n/g, '');
    const downloadUrl = String(res?.download_url || '');
    if (encoding !== 'base64' || !contentB64) {
      agent.appendHistory({
        role: 'assistant',
        content: downloadUrl
          ? `GitHub file too large or not directly readable via API: ${path} @ ${ref}\nDownload URL: ${downloadUrl}`
          : `GitHub file is not directly readable via API: ${path} @ ${ref}`
      });
      return true;
    }

    const full = fromBase64Utf8(contentB64);
    const text = full.length > maxChars ? `${full.slice(0, maxChars)}\n\n[truncated]` : full;

    if (shareWithUser) {
      agent.appendHistory({
        role: 'assistant',
        content: `GitHub file: ${path} @ ${ref}\n\n${text}`
      });
    } else {
      agent.appendHistory({
        role: 'assistant',
        content: `GitHub file (internal): ${path} @ ${ref}\n\n${text}`,
        metadata: { internal: true }
      });
    }
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    agent.appendHistory({ role: 'assistant', content: `GitHub read failed: ${msg}` });
    return false;
  }
}

export async function githubListRepoTree(
  agent: AgentActionContext,
  args: { path?: string; ref?: string; recursive?: boolean; maxEntries?: number; shareWithUser?: boolean }
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
    agent.appendHistory({ role: 'assistant', content: 'GitHub repo format is invalid. Use owner/repo.' });
    return false;
  }

  const prefix = String(args?.path || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (prefix && !isSafePath(prefix)) {
    agent.appendHistory({ role: 'assistant', content: `Unsafe path blocked: ${prefix}` });
    return false;
  }

  const token = cfg.token.trim();
  const ref = String(args?.ref || cfg.baseBranch || 'main').trim() || 'main';
  const recursive = args?.recursive !== false;
  const maxEntries = Math.max(50, Math.min(2000, Number(args?.maxEntries ?? 500)));
  const shareWithUser = Boolean(args?.shareWithUser) && userExplicitlyRequestedShare(agent.data.index);
  const { owner, name } = repoInfo;
  const apiBase = `https://api.github.com/repos/${owner}/${name}`;

  try {
    const refRes = await githubRequest(`${apiBase}/git/ref/heads/${encodeURIComponent(ref)}`, token);
    const commitSha = String(refRes?.object?.sha || '');
    if (!commitSha) throw new Error('Failed to resolve branch SHA.');

    const commit = await githubRequest(`${apiBase}/git/commits/${commitSha}`, token);
    const treeSha = String(commit?.tree?.sha || '');
    if (!treeSha) throw new Error('Failed to resolve tree SHA.');

    const tree = await githubRequest(`${apiBase}/git/trees/${treeSha}?recursive=${recursive ? '1' : '0'}`, token);
    const entries: any[] = Array.isArray(tree?.tree) ? tree.tree : [];

    const filtered = prefix
      ? entries.filter((e) => String(e?.path || '').startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`) || String(e?.path || '') === prefix)
      : entries;

    const lines = filtered
      .slice(0, maxEntries)
      .map((e) => {
        const type = String(e?.type || '');
        const size = typeof e?.size === 'number' ? String(e.size) : '';
        const p = String(e?.path || '');
        return `${type}${size ? ` ${size}` : ''} ${p}`.trim();
      })
      .join('\n');

    if (shareWithUser) {
      const truncated = filtered.slice(0, Math.min(200, maxEntries));
      const publicLines = truncated
        .map((e) => {
          const type = String(e?.type || '');
          const p = String(e?.path || '');
          return `${type} ${p}`.trim();
        })
        .join('\n');
      agent.appendHistory({
        role: 'assistant',
        content: `GitHub tree @ ${ref}${prefix ? ` (path: ${prefix})` : ''}\n${publicLines || '(no entries)'}${filtered.length > truncated.length ? '\n\n[truncated]' : ''}`,
      });
    } else {
      agent.appendHistory({
        role: 'assistant',
        content: `GitHub tree @ ${ref}${prefix ? ` (path: ${prefix})` : ''}\n${lines || '(no entries)'}`,
        metadata: { internal: true }
      });
      agent.appendHistory({
        role: 'assistant',
        content: `Repo tree loaded internally (${Math.min(filtered.length, maxEntries)} entries). Ask if you want me to show it.`
      });
    }
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    agent.appendHistory({ role: 'assistant', content: `GitHub list failed: ${msg}` });
    return false;
  }
}

export async function githubSearchCode(
  agent: AgentActionContext,
  args: { query: string; path?: string; perPage?: number; page?: number; shareWithUser?: boolean }
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
    agent.appendHistory({ role: 'assistant', content: 'GitHub repo format is invalid. Use owner/repo.' });
    return false;
  }

  const query = String(args?.query || '').trim();
  if (!query) {
    agent.appendHistory({ role: 'assistant', content: 'Missing search query.' });
    return false;
  }

  const path = String(args?.path || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (path && !isSafePath(path)) {
    agent.appendHistory({ role: 'assistant', content: `Unsafe path blocked: ${path}` });
    return false;
  }

  const perPage = Math.max(1, Math.min(50, Number(args?.perPage ?? 10)));
  const page = Math.max(1, Math.min(10, Number(args?.page ?? 1)));
  const shareWithUser = Boolean(args?.shareWithUser) && userExplicitlyRequestedShare(agent.data.index);
  const token = cfg.token.trim();
  const { owner, name } = repoInfo;

  try {
    const q = `${query} repo:${owner}/${name}${path ? ` path:${path}` : ''}`;
    const url = `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=${perPage}&page=${page}`;
    const res = await githubRequest(url, token);
    const items: any[] = Array.isArray(res?.items) ? res.items : [];

    const lines = items
      .map((it) => {
        const filePath = String(it?.path || '');
        const htmlUrl = String(it?.html_url || '');
        return `- ${filePath}${htmlUrl ? ` (${htmlUrl})` : ''}`;
      })
      .join('\n');

    if (shareWithUser) {
      agent.appendHistory({
        role: 'assistant',
        content: `GitHub search results (${items.length}):\n${lines || '(no matches)'}`
      });
    } else {
      agent.appendHistory({
        role: 'assistant',
        content: `GitHub search results (${items.length}):\n${lines || '(no matches)'}`,
        metadata: { internal: true }
      });
      agent.appendHistory({
        role: 'assistant',
        content: `Search completed internally (${items.length} results). Ask if you want me to show the matches.`
      });
    }
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    agent.appendHistory({ role: 'assistant', content: `GitHub search failed: ${msg}` });
    return false;
  }
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
