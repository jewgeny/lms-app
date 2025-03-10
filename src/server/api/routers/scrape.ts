import { createTRPCRouter, publicProcedure } from "../trpc";
import puppeteer, { Page } from "puppeteer";
import { z } from "zod";
import { db } from "../../db";

type Location = {
  name: string;
  link: string;
  address: string;
  phone: string;
  website: string;
  opening_time: string;
  img: string;
  rating: string;
  category: string;
  email?: string;
};

export const scrapeRouter = createTRPCRouter({
  scrapeGoogleMaps: publicProcedure
    .input(z.object({ query: z.string(), operationId: z.string().optional() }))
    .mutation(async ({ input }) => {
      const operationId = input.operationId || `op-${Date.now()}`;
      const url = `https://www.google.com/maps/search/${encodeURIComponent(input.query)}`;

      const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      const detailedLocations: Location[] = [];

      try {
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

        const cookieBtnSelector = 'button[aria-label="Alle ablehnen"]';
        if (await page.$(cookieBtnSelector)) {
          await page.click(cookieBtnSelector);
        }

        await autoScroll(page);

        const locations: { name: string; link: string }[] = await page.evaluate(() => {
          return Array.from(document.querySelectorAll(".Nv2PK")).map((el) => ({
            name: el.querySelector(".qBF1Pd")?.textContent?.trim() ?? "Unknown Name",
            link: (el.querySelector("a") as HTMLAnchorElement)?.href ?? "",
          }));
        });

        for (const location of locations) {
          const detailPage = await browser.newPage();

          try {
            await detailPage.goto(location.link, { waitUntil: "networkidle2" });

            const data = await detailPage.evaluate(() => ({
              address: document.querySelector(".CsEnBe .Io6YTe")?.textContent?.trim() ?? "",
              phone: document.querySelector('.RcCsl [data-tooltip*="Telefonnummer"] .Io6YTe')?.textContent?.trim() ?? "",
              website: (document.querySelector(".RcCsl a.CsEnBe") as HTMLAnchorElement)?.href ?? "",
              opening_time: document.querySelector(".OqCZI .ZDu9vd span span")?.textContent?.trim() ?? "",
              img: (document.querySelector(".ZKCDEc img") as HTMLImageElement)?.src ?? "",
              rating: document.querySelector(".Bd93Zb .fontDisplayLarge")?.textContent?.trim() ?? "",
              category: document.querySelector(".DkEaL")?.textContent?.trim() ?? "Unknown Category",
              email: document.querySelector(".some-email-selector")?.textContent?.trim() ?? "",
            }));

            detailedLocations.push({ ...location, ...data });
          } catch (error) {
            console.error(`Error scraping details for ${location.name}:`, error);
          } finally {
            await detailPage.close();
          }
        }

        await page.close();

        await db.leads.createMany({
          data: detailedLocations.map((location) => ({
            name: location.name,
            link: location.link,
            address: location.address,
            phone: location.phone,
            website: location.website,
            opening_time: location.opening_time,
            img: location.img,
            rating: location.rating,
            email: location.email?.trim() !== "" 
              ? location.email 
              : `no-email-${Date.now()}@example.com`,
            operationId,
            category: location.category,
          })),
          skipDuplicates: true,
        });

        return db.leads.findMany({ where: { operationId } });
      } catch (error) {
        console.error("Scraping error:", error);
        throw new Error(`Scraping failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await browser.close();
      }
    }),
});

// Función robusta para autoScroll
async function autoScroll(page: Page, retries = 50) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const reachedEnd = await page.evaluate(() => {
        const wrapper = document.querySelector('div[role="feed"], div.m6QErb[role="main"]');
        if (!wrapper) throw new Error("Scrollable section not found");

        wrapper.scrollBy(0, 1000);
        
        const endTexts = ["You've reached the end of the list.", "Das Ende der Liste ist erreicht."];
        const spanTexts = Array.from(document.querySelectorAll('span')).map(span => span.textContent || "");
        
        return endTexts.some(text => spanTexts.includes(text));
      });

      if (reachedEnd) {
        console.log("Reached the end of the list.");
        break;
      }

      await page.waitForTimeout(1000);
    } catch (error) {
      console.warn(`autoScroll attempt ${attempt}/${retries} failed:`, error);
      if (attempt === retries) throw error;
      await page.waitForTimeout(2000);
    }
  }
}
