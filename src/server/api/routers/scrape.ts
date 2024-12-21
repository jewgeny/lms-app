import { createTRPCRouter, publicProcedure } from "../trpc";
import * as puppeteer from "puppeteer";
import { z } from "zod";

// Define the Location interface
interface Location {
  name: string;
  rating: number;
  typeBusiness: string;
  reviewNumber: string;
  link: string;
  address: string;
}

// Create a TRPC router for scraping Google Maps
export const scrapeRouter = createTRPCRouter({
  scrapeGoogleMaps: publicProcedure
    .input(z.object({ query: z.string() })) // Define the input schema
    .mutation(async ({ input, signal }) => {
      const searchQuery = input.query;
      const url = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery.split(" ").join("+"))}`;
      console.log("Navigating to URL:", url);

      // Launch Puppeteer browser
      const browser = await puppeteer.launch({
        executablePath: '/usr/bin/google-chrome', // Path to Chrome executable
        headless: false, // Run in headless mode
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'], // Additional arguments
      });

      console.log("Browser launched");

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

        // Extract locations from the page
        const locations: Location[] = await page.evaluate(() => {
          const elements = document.querySelectorAll('.Nv2PK'); // Multiple elements
          return Array.from(elements).map(el => ({
            name: (el.querySelector(".qBF1Pd") as HTMLElement)?.innerText ?? "Unknown Name",
            rating: parseFloat((el.querySelector(".W4Efsd") as HTMLElement)?.innerText ?? "0"),
            reviewNumber: (el.querySelector(".UY7F9") as HTMLElement)?.innerText ?? "Unknown Type",
            typeBusiness: (el.querySelector(".UY7F9") as HTMLElement)?.innerText ?? "Unknown Type",
            link: (el.querySelector("a") as HTMLAnchorElement)?.href ?? "No Link Available",
            address: (el.querySelector("#QA0Szd > div > div > div.w6VYqd > div.bJzME.tTVLSc > div > div.e07Vkf.kA9KIf > div > div > div.m6QErb.DxyBCb.kA9KIf.dS8AEf.XiKgde.ecceSd > div.m6QErb.DxyBCb.kA9KIf.dS8AEf.XiKgde.ecceSd.QjC7t > div:nth-child(61) > div > div.bfdHYd.Ppzolf.OFBs3e > div.lI9IFe > div.y7PRA > div > div > div.UaQhfb.fontBodyMedium > div:nth-child(4) > div:nth-child(1) > span:nth-child(3) > span:nth-child(2)") as HTMLElement)?.innerText ?? "No Address Available"
          }));
        });

        // Click on each link and extract additional data
        for (const location of locations) {
          const detailPage = await browser.newPage();
          await detailPage.goto(location.link, { waitUntil: "networkidle2" });

          // Extract additional data from the detail page
          const additionalData = await detailPage.evaluate(() => {
            return {
              phoneNumber: (document.querySelector('.Io6YTe .fontBodyMedium .kR99db .fdkmkc ') as HTMLElement)?.innerText ?? "No Phone Number",
              website: (document.querySelector('.m6QErb .DUwDvf') as HTMLAnchorElement)?.href ?? "No Website"
            };
          });

          // Merge additional data with the location
          Object.assign(location, additionalData);

          await detailPage.close();
        }

        console.log("Scraping succeeded");
        return locations; // Return the extracted locations
      } catch (error) {
        console.error("Scraping failed:", error instanceof Error ? error.message : error);
        throw new Error("Scraping failed: " + (error instanceof Error ? error.message : String(error)));
      } finally {
        await browser.close(); // Close the browser
        console.log("Browser closed");
      }
    })
})