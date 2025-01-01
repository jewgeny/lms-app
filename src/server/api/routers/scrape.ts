import { createTRPCRouter, publicProcedure } from "../trpc";
import chromium from "@sparticuz/chromium";
import * as puppeteer from "puppeteer";
import { z } from "zod";
import { db } from "../../db"; // Import Prisma client

const getExecutablePath = async (): Promise<string> => {
  if (process.env.NODE_ENV === "development") {
    if (process.platform === "darwin") {
      return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; // macOS
    } else if (process.platform === "win32") {
      return "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"; // Windows
    } else if (process.platform === "linux") {
      return "/usr/bin/google-chrome"; // Linux
    } else {
      throw new Error("Unsupported platform: " + process.platform);
    }
  }

  console.log("Using Chromium for production");
  return await chromium.executablePath(); // Serverless
};

export const scrapeRouter = createTRPCRouter({
  scrapeGoogleMaps: publicProcedure
    .input(z.object({ query: z.string() })) // Define the input schema
    .mutation(async ({ input, signal }) => {
      const searchQuery = input.query;
      const url = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery.split(" ").join("+"))}`;
      console.log("Navigating to URL:", url);

      const executablePath = await getExecutablePath();
      const browser = await puppeteer.launch({
        defaultViewport: chromium.defaultViewport,
        executablePath,
        headless: chromium.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      try {
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "networkidle2", signal });

        await new Promise(resolve => setTimeout(resolve, 1000));
        await page.waitForSelector('button[aria-label="Alle ablehnen"]', { timeout: 10000 });
        await page.click('button[aria-label="Alle ablehnen"]');
        await new Promise(resolve => setTimeout(resolve, 10000));

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

        await autoScroll(page);

        interface Location {
          name: string;
          link: string;
          address?: string;
          phone?: string;
          website?: string;
          opening_time?: string;
          img?: string;
          rating?: string;
          email?: string;
        }

        const locations: Location[] = await page.evaluate(() => {
          const elements = document.querySelectorAll(".Nv2PK");
          return Array.from(elements).map(el => ({
            name: (el.querySelector(".qBF1Pd") as HTMLElement)?.innerText ?? "Unknown Name",
            link: (el.querySelector("a") as HTMLAnchorElement)?.href ?? "No Link Available",
          }));
        });

        for (const location of locations) {
          try {
            const detailPage = await browser.newPage();
            await detailPage.goto(location.link, { waitUntil: "networkidle2", timeout: 30000 });

            const additionalData = await detailPage.evaluate(() => ({
              address: document.querySelector(".CsEnBe .Io6YTe")?.textContent ?? "No Address Available",
              phone: document.querySelector('.RcCsl [data-tooltip="Telefonnummer kopieren"] .Io6YTe')?.textContent ?? "No Phone Available",
              website: document.querySelector(".RcCsl a.CsEnBe")?.getAttribute('href') ?? "No Website Available",
              opening_time: document.querySelector(".OqCZI .ZDu9vd span span ")?.textContent ?? "No Opening Time Available",
              img: document.querySelector(".ZKCDEc img")?.getAttribute('src') ?? "No Image Available",
              rating: document.querySelector(".Bd93Zb .jANrlb .fontDisplayLarge")?.textContent ?? "No Rating Available"
            }));

            Object.assign(location, additionalData);
            await detailPage.close();
          } catch (error) {
            console.error(`Error processing detail page for ${location.name}:`, error);
          }
        }

        for (const location of locations) {
          try {
            const uniqueEmail = location.email || `no-email-${Date.now()}@example.com`;
            await db.lead.create({
              data: {
                name: location.name,
                link: location.link,
                address: location.address,
                phone: location.phone,
                website: location.website,
                opening_time: location.opening_time,
                img: location.img,
                rating: location.rating,
                email: uniqueEmail,
              },
            });
          } catch (error) {
            console.error(`Error saving location ${location.name} to the database:`, error);
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