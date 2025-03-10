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

        async function autoScroll(page: puppeteer.Page, retries = 50) {
          for (let i = 0; i < retries; i++) {
            try {
              const endOfListText = ["You've reached the end of the list.", "Das Ende der Liste ist erreicht."];
              const reachedEnd = await page.evaluate((endOfListText: string | string[]) => {
                const wrapper = document.querySelector('div[role="feed"]');
                if (!wrapper) throw new Error("Scrollable section not found");

                const endTextElement = Array.from(document.querySelectorAll('span')).find(el => endOfListText.includes(el.textContent || ""));
                return !!endTextElement;
              }, endOfListText);

              if (reachedEnd) {
                console.log("Reached the end of the list.");
                break;
              }

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
            console.error(`Error scraping detail for ${location.name}:`, error);
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
            email:
              location.email && location.email.trim() !== ""
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

// Auto-scroll function
async function autoScroll(page: Page) {
  await page.evaluate(async () => {
    const wrapper = document.querySelector('div[role="feed"]');
    if (!wrapper) throw new Error("Scrollable section not found");

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        wrapper.scrollBy(0, 1000);
        if (wrapper.scrollTop + wrapper.clientHeight >= wrapper.scrollHeight) {
          clearInterval(interval);
          resolve();
        }
      }, 500);
    });
  });
}
