"use client"; // This is a client component

import { useState } from "react";
import { api } from "../../utils/api";

export default function Home() {
  const [query, setQuery] = useState<string>("");
  const [results, setResults] = useState<{ name: string; link: string }[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const scrapeGoogleMaps = api.scrape.scrapeGoogleMaps.useMutation({
    onSuccess: (data) => {
      setResults(data);
      setLoading(false);
    },
    onError: (err) => {
      setError(err.message);
      setLoading(false);
    },
  });

  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    setResults([]);
    scrapeGoogleMaps.mutate({ query });
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Google Maps Scraper</h1>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Enter search query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="border p-2 w-80"
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="bg-blue-500 text-white p-2"
        >
          {loading ? "Loading..." : "Search"}
        </button>
      </div>

      {error && <p className="text-red-500">{error}</p>}

      <ul>
        {results.map((result, index) => (
          <li key={index} className="mb-2">
            <strong>{result.name}</strong> -{" "}
            <a href={result.link} target="_blank" rel="noopener noreferrer" className="text-blue-500">
              View on Google Maps
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}