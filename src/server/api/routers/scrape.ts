import { createTRPCRouter, publicProcedure } from "../trpc";
import * as puppeteer from "puppeteer";
import { z } from "zod";

export const scrapeRouter = createTRPCRouter({
  scrapeGoogleMaps: publicProcedure
    .input(z.object({ query: z.string() })) // Define the input schema
    .mutation(async ({ input, signal }) => {
      const searchQuery = input.query;
      const url = `https://www.google.com/maps/search/${encodeURIComponent(
        searchQuery.split(" ").join("+")
      )}`;
      console.log("Navigating to URL:", url);

      // Launch Puppeteer browser
      const browser = await puppeteer.launch({
        executablePath: "/usr/bin/google-chrome", // Path to Chrome executable for Linux
        headless: false, // Run in headless mode
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });

      try {
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "networkidle2", signal });

        await page.waitForSelector('button[aria-label="Alle ablehnen"]', { timeout: 10000 });
        await page.click('button[aria-label="Alle ablehnen"]');
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Auto-scroll function
        async function autoScroll(page: puppeteer.Page, maxAttempts: number = 50): Promise<void> {
          let previousHeight = 0;
          let attempts = 0;

          while (attempts < maxAttempts) {
            try {
              const currentUrl = page.url();
              if (!currentUrl.includes("google.com/maps/search")) {
                console.log("Page navigated away, stopping auto-scroll");
                throw new Error("Page navigated away from Google Maps search");
              }

              const { currentHeight, elementCount } = await page.evaluate(async () => {
                const findScrollableSection = async (attempts: number = 10): Promise<Element | null> => {
                  for (let j = 0; j < attempts; j++) {
                    const wrapper = document.querySelector('div[role="feed"]');
                    if (wrapper) return wrapper;
                    console.warn(`Attempt ${j + 1}: Scrollable section not found. Retrying...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                  }
                  return null;
                };

                const wrapper = await findScrollableSection();
                if (!wrapper) {
                  console.warn("Scrollable section not found after multiple attempts.");
                  throw new Error("Scrollable section not found");
                }

                const initialElementCount = document.querySelectorAll(".Nv2PK").length;
                wrapper.scrollBy(0, 1000);
                await new Promise(resolve => setTimeout(resolve, 1000));
                const newElementCount = document.querySelectorAll(".Nv2PK").length;

                return {
                  currentHeight: wrapper.scrollHeight,
                  elementCount: newElementCount - initialElementCount,
                };
              });

              if (currentHeight === previousHeight && elementCount === 0) {
                attempts++;
              } else {
                attempts = 0;
                previousHeight = currentHeight;
              }

              await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
              if (error instanceof Error && error.message.includes("Execution context was destroyed")) {
                console.warn("Execution context was destroyed, retrying...");
              } else {
                console.error(`Auto-scroll attempt ${attempts + 1} failed:`, error);
              }
              attempts++;
              await new Promise(resolve => setTimeout(resolve, 5000));
            }
          }
        }

        await autoScroll(page);

        const locations = await page.evaluate(() => {
          const elements = document.querySelectorAll(".Nv2PK");
          return Array.from(elements).map(el => ({
            name: (el.querySelector(".qBF1Pd") as HTMLElement)?.innerText ?? "Unknown Name",
            link: el.querySelector("a")?.href ?? "No Link Available",
          }));
        });

        // Process detail pages with concurrency limit
        interface Location {
          name: string;
          link: string;
          address?: string;
          phone?: string;
          website?: string;
          opening_time?: string;
          img?: string;
          rating?: string;
        }

        const processDetailPages = async (locations: Location[], concurrency = 3): Promise<void> => {
          const batches: Location[][] = [];
          for (let i = 0; i < locations.length; i += concurrency) {
            batches.push(locations.slice(i, i + concurrency));
          }

          for (const batch of batches) {
            await Promise.all(
              batch.map(async (location: Location) => {
                for (let attempt = 0; attempt < 3; attempt++) {
                  try {
                    const detailPage = await browser.newPage();
                    await detailPage.goto(location.link, {
                      waitUntil: "networkidle2",
                      timeout: 60000,
                    });

                    const additionalData: Partial<Location> = await detailPage.evaluate(() => ({
                      address: document.querySelector(".CsEnBe .Io6YTe")?.textContent ?? "No Address Available",
                      phone: document.querySelector(
                      '.RcCsl [data-tooltip="Telefonnummer kopieren"] .Io6YTe'
                      )?.textContent ?? "No Phone Available",
                      website: document.querySelector(".RcCsl a.CsEnBe")?.getAttribute("href") ?? "No Website Available",
                      opening_time: document.querySelector(".OqCZI .ZDu9vd span span")?.textContent ?? "No Opening Time Available",
                      img: document.querySelector(".ZKCDEc img")?.getAttribute("src") ?? "No Image Available",
                      rating: document.querySelector(".Bd93Zb .jANrlb .fontDisplayLarge")?.textContent ?? "No Rating Available",
                    }));

                    Object.assign(location, additionalData);
                    await detailPage.close();
                    break; // Exit retry loop on success
                  } catch (error) {
                    console.error(`Error processing detail page for ${location.name} (attempt ${attempt + 1}):`, error);
                    if (attempt === 2) {
                      console.error(`Failed to process detail page for ${location.name} after 3 attempts.`);
                    }
                  }
                }
              })
            );
          }
        };

        await processDetailPages(locations);
        return locations;
      } catch (error) {
        console.error("Scraping failed:", error);
        throw new Error(
          "Scraping failed: " + (error instanceof Error ? error.message : String(error))
        );
      } finally {
        await browser.close();
      }
    }),
});
