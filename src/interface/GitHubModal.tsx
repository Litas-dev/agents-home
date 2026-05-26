import { Check, Eye, EyeOff, Github, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useUiStore } from '../integration/store/uiStore';

const STORAGE_KEY = 'github-config';

export default function GitHubModal({ onClose }: { onClose: () => void }) {
  const { githubConfig, setGitHubConfig } = useUiStore();

  const [token, setToken] = useState(githubConfig.token || '');
  const [repo, setRepo] = useState(githubConfig.repo || '');
  const [baseBranch, setBaseBranch] = useState(githubConfig.baseBranch || 'main');
  const [showToken, setShowToken] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [oauthEnabled, setOauthEnabled] = useState(false);
  const [isOauthStarting, setIsOauthStarting] = useState(false);
  const [repos, setRepos] = useState<string[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const popupRef = useRef<Window | null>(null);

  const normalizedRepo = useMemo(() => repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, ''), [repo]);
  const isValidRepo = normalizedRepo.split('/').filter(Boolean).length === 2;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch('/api/github/oauth/config');
        const json = await resp.json().catch(() => null);
        if (!cancelled) setOauthEnabled(Boolean(json?.enabled));
      } catch {
        if (!cancelled) setOauthEnabled(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e?.data || typeof e.data !== 'object') return;
      if (e.origin !== window.location.origin) return;
      if (e.data.type !== 'github_oauth_token') return;
      const t = String(e.data.token || '').trim();
      if (!t) return;
      setToken(t);
      setStatus({ ok: true, msg: 'GitHub login successful. Load repos or paste owner/repo, then Save.' });
      try { popupRef.current?.close(); } catch { }
      popupRef.current = null;
      setIsOauthStarting(false);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleLogin = () => {
    setStatus(null);
    setIsOauthStarting(true);
    try {
      const w = window.open('/api/github/oauth/start', 'github_oauth', 'width=520,height=720');
      popupRef.current = w;
      if (!w) {
        setIsOauthStarting(false);
        setStatus({ ok: false, msg: 'Popup blocked. Allow popups and try again.' });
      }
    } catch (e) {
      setIsOauthStarting(false);
      setStatus({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    }
  };

  const loadRepos = async () => {
    setStatus(null);
    if (!token.trim()) {
      setStatus({ ok: false, msg: 'Missing token' });
      return;
    }
    setIsLoadingRepos(true);
    try {
      const resp = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          Accept: 'application/vnd.github+json',
        },
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        const msg = (json?.message ? String(json.message) : `HTTP ${resp.status}`).trim();
        setStatus({ ok: false, msg });
        setRepos([]);
        return;
      }
      const items = Array.isArray(json) ? json : [];
      const names = items
        .map((r: any) => String(r?.full_name || ''))
        .filter((s: string) => s.includes('/'));
      const unique = Array.from(new Set(names));
      setRepos(unique);
      if (!repo.trim() && unique.length > 0) setRepo(unique[0]);
      setStatus({ ok: true, msg: `Loaded ${unique.length} repos.` });
    } catch (e) {
      setStatus({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsLoadingRepos(false);
    }
  };

  const handleSave = () => {
    const next = {
      token: token.trim(),
      repo: normalizedRepo,
      baseBranch: baseBranch.trim() || 'main',
    };
    setGitHubConfig(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch { }
    onClose();
  };

  const handleValidate = async () => {
    setStatus(null);
    if (!token.trim()) {
      setStatus({ ok: false, msg: 'Missing token' });
      return;
    }
    if (!isValidRepo) {
      setStatus({ ok: false, msg: 'Repo must be owner/repo' });
      return;
    }
    setIsValidating(true);
    try {
      const [owner, name] = normalizedRepo.split('/');
      const resp = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          Accept: 'application/vnd.github+json',
        },
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        const msg = (json?.message ? String(json.message) : `HTTP ${resp.status}`).trim();
        setStatus({ ok: false, msg });
      } else {
        const branch = typeof json?.default_branch === 'string' ? json.default_branch : baseBranch.trim() || 'main';
        setBaseBranch(branch);
        setStatus({ ok: true, msg: `Connected (${owner}/${name}, default branch: ${branch})` });
      }
    } catch (e) {
      setStatus({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-6 pointer-events-auto overflow-hidden">
      <div onClick={onClose} className="absolute inset-0 bg-white/60 backdrop-blur-xl" />
      <div className="relative w-full max-w-md bg-white rounded-[40px] shadow-[0_32px_64px_-12px_rgba(0,0,0,0.1)] p-8 md:p-10 border border-zinc-100">
        <button onClick={onClose} className="absolute top-6 right-6 text-zinc-300 hover:text-zinc-600 transition-colors cursor-pointer">
          <X size={18} />
        </button>

        <div className="max-w-md mx-auto">
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Github size={18} className="text-darkDelegation" />
              <h2 className="text-3xl font-black text-darkDelegation tracking-tight">
                GitHub
              </h2>
            </div>
            <p className="text-zinc-400 text-sm font-medium leading-relaxed max-w-[280px]">
              Token is stored locally in your browser.
            </p>
          </div>

          {oauthEnabled && (
            <div className="mb-6 p-4 rounded-3xl border border-zinc-100 bg-zinc-50">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 mb-2">
                Login
              </p>
              <button
                onClick={handleLogin}
                disabled={isOauthStarting}
                className="w-full px-5 py-3 bg-white hover:bg-zinc-100 border border-zinc-200 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all active:scale-95 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {isOauthStarting ? 'Opening…' : 'Login with GitHub'}
              </button>
              <p className="mt-2 text-[10px] text-zinc-400 font-medium leading-relaxed">
                Available in dev mode with a local server.
              </p>
            </div>
          )}

          {status && (
            <div className={`mb-6 p-3 rounded-2xl flex items-start gap-2 border ${status.ok ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
              <div className={`mt-0.5 shrink-0 ${status.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                <Check size={14} strokeWidth={3} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-[10px] font-black uppercase tracking-wider mb-0.5 ${status.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                  {status.ok ? 'Connected' : 'Error'}
                </p>
                <p className={`text-[11px] font-medium leading-tight break-words whitespace-pre-wrap ${status.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                  {status.msg}
                </p>
              </div>
            </div>
          )}

          <div className="mb-8">
            <div className="flex items-center justify-between mb-4 px-1">
              <label className="block text-[11px] font-black uppercase tracking-[0.2em] text-zinc-300">
                Repo (owner/repo)
              </label>
              <button
                onClick={loadRepos}
                disabled={isLoadingRepos || !token.trim()}
                className="text-[9px] font-black uppercase tracking-widest text-zinc-400 hover:text-darkDelegation transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {isLoadingRepos ? 'Loading…' : 'Load My Repos'}
              </button>
            </div>

            {repos.length > 0 ? (
              <select
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                className="w-full bg-zinc-50 border border-zinc-100 rounded-3xl px-6 py-4 text-sm text-darkDelegation font-mono focus:outline-none focus:border-zinc-200 transition-all shadow-sm cursor-pointer"
              >
                {repos.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="owner/repo"
                className="w-full bg-zinc-50 border border-zinc-100 rounded-3xl px-6 py-4 text-sm text-darkDelegation font-mono placeholder:text-zinc-300 placeholder:font-sans focus:outline-none focus:border-zinc-200 transition-all shadow-sm"
              />
            )}
          </div>

          <div className="mb-8">
            <label className="block text-[11px] font-black uppercase tracking-[0.2em] text-zinc-300 mb-4 ml-1">
              Base Branch
            </label>
            <input
              type="text"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              placeholder="main"
              className="w-full bg-zinc-50 border border-zinc-100 rounded-3xl px-6 py-4 text-sm text-darkDelegation font-mono placeholder:text-zinc-300 placeholder:font-sans focus:outline-none focus:border-zinc-200 transition-all shadow-sm"
            />
          </div>

          <div className="mb-10">
            <label className="block text-[11px] font-black uppercase tracking-[0.2em] text-zinc-300 mb-4 ml-1">
              Token
            </label>
            <div className="relative group">
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste fine-grained PAT here"
                className="w-full bg-zinc-50 border border-zinc-100 rounded-3xl px-6 py-4 pr-14 text-sm text-darkDelegation font-mono placeholder:text-zinc-300 placeholder:font-sans focus:outline-none focus:border-zinc-200 transition-all shadow-sm group-hover:shadow-md"
              />
              <button
                type="button"
                onClick={() => setShowToken(v => !v)}
                className="absolute right-5 top-1/2 -translate-y-1/2 text-zinc-200 hover:text-zinc-400 transition-colors cursor-pointer"
              >
                {showToken ? <EyeOff size={20} strokeWidth={2.5} /> : <Eye size={20} strokeWidth={2.5} />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              onClick={handleValidate}
              disabled={isValidating}
              className="px-5 py-3 bg-zinc-100 hover:bg-zinc-200 rounded-[18px] text-[10px] font-black uppercase tracking-[0.2em] transition-all active:scale-95 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {isValidating ? 'Checking…' : 'Test'}
            </button>
            <button
              onClick={handleSave}
              disabled={!token.trim() || !isValidRepo}
              className="px-12 py-4 bg-darkDelegation text-white rounded-[24px] text-xs font-black uppercase tracking-[0.2em] hover:bg-black transition-all active:scale-95 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100 shadow-xl shadow-black/10"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
