"use client";

import { useState } from "react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination"; // Import Pagination component

interface Business {
  name: string;
  link: string;
  address?: string | null;
  phone?: string | null;
  website?: string | null;
  opening_time?: string | null;
  img?: string | null;
  rating?: string | null;
  category?: string | null;
}

export default function ScraperPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Business[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const resultsPerPage = 10;

  const scrapeGoogleMaps = api.scrape.scrapeGoogleMaps.useMutation({
    onSuccess: (data) => {
      console.log('DATA', data);

      setResults(data);
      setLoading(false);
    },
    onError: (err) => {
      if (err.data?.code === 'CLIENT_CLOSED_REQUEST') {
        setError("Query stopped by user.");
      } else {
        setError(err.message || "An error occurred");
      }
      setLoading(false);
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      setError("Please enter a search query.");
      scrapeGoogleMaps.mutate({ query });
    }

    setLoading(true);
    setError(null);
    setResults([]);
    scrapeGoogleMaps.mutate({ query });
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const indexOfLastResult = currentPage * resultsPerPage;
  const indexOfFirstResult = indexOfLastResult - resultsPerPage;
  const currentResults = results.slice(indexOfFirstResult, indexOfLastResult);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Google Maps Scraper</h1>
      <div className="flex gap-2 mb-4">
        <form onSubmit={handleSearch} className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Enter search query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border p-2 w-80"
          />
          <Button
            type="submit"
            disabled={loading}
            className="bg-blue-500 text-white p-2"
            variant="outline"
          >
            Query
          </Button>
          {loading && (
            <div className="flex items-center justify-center">
              <p className="text-blue-500 animate-pulse font-semibold">
                Loading, please wait...
              </p>
            </div>
          )}
        </form>
      </div>

      {error && <p className="text-red-500">{error}</p>}

      {results.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Index</TableHead>
                <TableHead>Bild</TableHead>
                <TableHead>Titel</TableHead>
                <TableHead>Kategorie</TableHead>
                <TableHead>Adresse</TableHead>
                <TableHead>Telefon</TableHead>
                <TableHead>Webseite</TableHead>
                <TableHead>Map</TableHead>
                <TableHead>Öffnungszeiten</TableHead>
                <TableHead>Bewertung</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentResults.map((result, index) => (
                <TableRow key={index} className="mb-2">
                  <TableCell className="font-medium">{indexOfFirstResult + index + 1}</TableCell>
                  <TableCell>
                    {result.img ? (
                      <div
                        style={{
                          backgroundImage: `url(${result.img})`,
                          width: "100px",
                          height: "100px",
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }}
                      ></div>
                    ) : (
                      "No Image"
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{result.name}</TableCell>
                  <TableCell className="font-medium">{result.category}</TableCell>
                  <TableCell className="font-medium">{result.address ?? "N/A"}</TableCell>
                  <TableCell className="font-medium">{result.phone ?? "N/A"}</TableCell>
                  <TableCell className="font-medium">
                    {result.website ? (
                      <a
                        href={result.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 underline"
                      >
                        Website
                      </a>
                    ) : (
                      "N/A"
                    )}
                  </TableCell>
                  <TableCell className="font-medium">
                    <a
                      href={result.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 underline"
                    >
                      Map
                    </a>
                  </TableCell>
                  <TableCell className="font-medium">
                    {result.opening_time ?? "N/A"}
                  </TableCell>
                  <TableCell className="font-medium">
                    {result.rating ?? "N/A"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            currentPage={currentPage}
            totalCount={results.length}
            pageSize={resultsPerPage}
            onPageChange={handlePageChange}
          />
        </>
      )}
    </div>
  );
}
