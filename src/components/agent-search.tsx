"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AgentSearch() {
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const handle = query.trim().replace(/^@/, '');
    if (!handle) return;

    setError('');
    try {
      const res = await fetch(`/api/agent/${handle}`);
      if (res.ok) {
        router.push(`/agent/${handle}`);
      } else {
        setError(`No agent found with handle "${handle}"`);
      }
    } catch {
      setError('Search failed. Try again.');
    }
  }

  return (
    <form onSubmit={handleSearch} className="mx-auto max-w-md">
      <label className="block text-sm font-medium mb-2 text-center">Verify an agent</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setError(''); }}
          placeholder="Enter Verigent handle..."
          className="flex-1 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm"
        />
        <button type="submit" className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white">
          Look up
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-400 text-center">{error}</p>}
    </form>
  );
}
