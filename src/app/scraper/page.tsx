"use client";

import { useState, useRef } from "react";
import { api } from "../../utils/api";
import type { TRPCClientError } from "@trpc/client";
import type { scrapeRouter } from "../../server/api/routers/scrape";

export default function Home() {
  const [query, setQuery] = useState<string>("");
  const [results, setResults] = useState<{ name: string; link: string; rating: number; reviewNumber: string }[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<TRPCClientError<typeof scrapeRouter> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const scrapeGoogleMaps = api.scrape.scrapeGoogleMaps.useMutation({
    onSuccess: (data) => {
      console.log("Scraping results:", data);
      setResults(data);
      setLoading(false);
    },
    onError: (error) => {
      console.error("Error during scraping:", error);
      setError({
        ...error,
        message: error.message ?? "An unexpected error occurred.",
        data: error.data ?? null,
        shape: error.shape ?? null,
      } as TRPCClientError<typeof scrapeRouter>);
      setLoading(false);
    },
  });

  const handleSearch = async () => {
    if (!query.trim()) {
      setError({
        message: "Search query cannot be empty",
        data: null,
        shape: null,
        meta: null,
        cause: null,
        name: "CustomError"
      } as unknown as TRPCClientError<typeof scrapeRouter>);
      return;
    }
    setLoading(true);
    setError(null);
    setResults([]);
    abortControllerRef.current = new AbortController();
    scrapeGoogleMaps.mutate({ query });
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setLoading(false);
      setError({
        message: "Scraping stopped by user",
        data: null,
        shape: null,
        meta: null,
        cause: null,
        name: "AbortError"
      } as unknown as TRPCClientError<typeof scrapeRouter>);
    }
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      await handleSearch();
    }
  };

  const parseError = (error: TRPCClientError<typeof scrapeRouter> | null) => {
    if (!error) return null;
    if (error.data && 'zodError' in error.data) return "Invalid input. Please check your query.";
    return error.message || "An unexpected error occurred.";
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Google Maps Scraper</h1>
      <div className="flex gap-2 mb-4">
        <input
          aria-label="Search query"
          type="text"
          placeholder="Enter search query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          className={`border p-2 w-80 ${loading ? "bg-gray-200 cursor-not-allowed" : ""}`}
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className={`bg-blue-500 text-white p-2 ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {loading ? "Loading..." : "Search"}
        </button>
        <button
          onClick={handleStop}
          disabled={!loading}
          className={`bg-red-500 text-white p-2 ${!loading ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          Stop
        </button>
      </div>

      {error && <p className="text-red-500">{parseError(error)}</p>}

      <ul>
        {results.length === 0 && !loading && <p>No results found.</p>}
        {results.map((result, index) => (
          <li key={index} className="mb-2">
            <strong>{result.name}</strong> -{" "}
            <a
              href={result.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500"
            >
            <strong>{result.rating}</strong> -{" "}
            <strong>{result.reviewNumber}</strong> -{" "}
              View on Google Maps
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
