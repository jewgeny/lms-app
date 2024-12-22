import { createTRPCRouter, publicProcedure } from "../trpc";
import * as puppeteer from "puppeteer";
import { z } from "zod";

// Define the Location interface
interface Location {
  name: string;
  link: string;
  address?: string;
  phone?: string;
  website?: string;
  opening_time?: string;
  img?:string;
}

export const scrapeRouter = createTRPCRouter({
  scrapeGoogleMaps: publicProcedure
  .input(z.object({ query: z.string() })) // Define the input schema
  .mutation(async ({ input, signal }) => {
    const searchQuery = input.query;
    const url = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery.split(" ").join("+"))}`;
    console.log("Navigating to URL:", url);

    // Launch Puppeteer browser
    const browser = await puppeteer.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // Path to Chrome executable
      headless: false, // Run in headless mode
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'], // Additional arguments
    });

      try {
        const page = await browser.newPage(); // Open a new page
        await page.goto(url, { waitUntil: "networkidle2", signal }); // Navigate to the URL

        await new Promise(resolve => setTimeout(resolve, 1000)); // Additional wait time before starting to scrape
        await page.waitForSelector('button[aria-label="Alle ablehnen"]', { timeout: 10000 }); // Wait for the "Reject all" button
        await page.click('button[aria-label="Alle ablehnen"]'); // Click the "Reject all" button
        await new Promise(resolve => setTimeout(resolve, 10000)); // Additional wait time before starting to scrape

        // Function to auto-scroll the page
        async function autoScroll(page: puppeteer.Page, retries = 50) {
          for (let i = 0; i < retries; i++) {
            try {
              await page.evaluate(async () => {
                const wrapper = document.querySelector('div[role="feed"]');
                if (!wrapper) throw new Error("Scrollable section not found");

                await new Promise<void>((resolve, _reject) => {
                  let totalHeight = 0;
                  const distance = 1000;
                  const scrollDelay = 3000;

                  const timer = setInterval(() => {
                    const scrollHeightBefore = wrapper.scrollHeight;
                    wrapper.scrollBy(0, distance);
                    totalHeight += distance;

                    if (totalHeight >= scrollHeightBefore) {
                      totalHeight = 0;
                      setTimeout(() => {
                        const scrollHeightAfter = wrapper.scrollHeight;

                        if (scrollHeightAfter > scrollHeightBefore) {
                          return;
                        } else {
                          clearInterval(timer);
                          resolve();
                        }
                      }, scrollDelay);
                    }
                  }, 200);
                });
              });
              return;
            } catch (error) {
              console.log(`Error during autoScroll, retrying... (${i + 1}/${retries})`);
              console.error(error);

              const currentUrl = page.url();
              if (!currentUrl.includes("google.com/maps/search")) {
                console.log("Page navigated away, stopping autoScroll");
                throw error;
              }

              await new Promise(resolve => setTimeout(resolve, 5000));
              if (i === retries - 1) throw error;
            }
          }
        }

        await autoScroll(page); // Auto-scroll the page to load more results


        // Extrahiere Standorte
        const locations = await page.evaluate(() => {
          const elements = document.querySelectorAll(".Nv2PK");
          return Array.from(elements).map(el => ({
            name: (el.querySelector(".qBF1Pd") as HTMLElement)?.innerText ?? "Unknown Name",
            link: (el.querySelector("a") as HTMLAnchorElement)?.href ?? "No Link Available",
          }));
        });

        // Detailseiten verarbeiten
        for (const location of locations) {
          try {
            const detailPage = await browser.newPage();
            await detailPage.goto(location.link, { waitUntil: "networkidle2", timeout: 30000 });

            const additionalData = await detailPage.evaluate(() => ({
              address: document.querySelector(".CsEnBe .Io6YTe")?.textContent ?? "No Address Available",
              phone: document.querySelector('.RcCsl [data-tooltip="Telefonnummer kopieren"] .Io6YTe')?.textContent ?? "No Phone Available",
              website: document.querySelector(".RcCsl a.CsEnBe")?.getAttribute('href') ?? "No Website Available",
              opening_time: document.querySelector(".OqCZI .ZDu9vd span span ")?.textContent ?? "No Opening Time Available",
              img: document.querySelector(".ZKCDEc img")?.getAttribute('src') ?? "No Image Available"
            }));

            Object.assign(location, additionalData);
            await detailPage.close();
          } catch (error) {
            console.error(`Error processing detail page for ${location.name}:`, error);
          }
        }

        return locations;
      } catch (error) {
        console.error("Scraping failed:", error);
        throw new Error("Scraping failed: " + (error instanceof Error ? error.message : String(error)));
      } finally {
        await browser.close();
      }
    }),
});

