"use client";

import { useState } from "react";
import { api } from "@/utils/api";

interface Business {
  name: string;
  link: string;
}

export default function ScraperPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Business[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrapeGoogleMaps = api.scrape.scrapeGoogleMaps.useMutation({
    onSuccess: (data) => {
      console.log('DATA', data);
      setResults(data);
      setLoading(false);
    },
    onError: (err) => {
      setError(err.message || "An error occurred");
      setLoading(false);
    },
  });

  const handleSearch = () => {
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
            <a
              href={result.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500"
            >
              View on Google Maps
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
