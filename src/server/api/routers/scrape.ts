import { createTRPCRouter, publicProcedure } from "../trpc";
import puppeteer from "puppeteer";
import { z } from "zod";
import { db } from "../../db";

const getChromiumExecutablePath = () => puppeteer.executablePath();

export const scrapeRouter = createTRPCRouter({
  scrapeGoogleMaps: publicProcedure
    .input(z.object({ query: z.string() }))
    .mutation(async ({ input, signal }) => {
      const url = `https://www.google.com/maps/search/${encodeURIComponent(input.query)}`;
      const browser = await puppeteer.launch({
        headless: true,
        executablePath: getChromiumExecutablePath(),
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      const operationId = `op-${Date.now()}`;

      try {
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

        // Aceptar cookies si existe el botón
        const cookieBtnSelector = 'button[aria-label="Alle ablehnen"]';
        if (await page.$(cookieBtnSelector)) {
          await page.click(cookieBtnSelector);
        }

        await autoScroll(page);

        const locations = await page.evaluate(() => {
          return Array.from(document.querySelectorAll(".Nv2PK")).map((el) => ({
            name: el.querySelector(".qBF1Pd")?.textContent ?? "Unknown Name",
            link: el.querySelector("a")?.href ?? "",
          }));
        });

        const detailedLocations = [];
        for (const location of locations) {
          const detailPage = await browser.newPage();
          try {
            await detailPage.goto(location.link, { waitUntil: "networkidle2" });

            const data = await detailPage.evaluate(() => ({
              address: document.querySelector(".CsEnBe .Io6YTe")?.textContent ?? "",
              phone: document.querySelector('.RcCsl [data-tooltip*="Telefonnummer"] .Io6YTe')?.textContent ?? "",
              website: (document.querySelector(".RcCsl a.CsEnBe") as HTMLAnchorElement | null)?.href ?? "",
              opening_time: document.querySelector(".OqCZI .ZDu9vd span span")?.textContent ?? "",
              img: (document.querySelector(".ZKCDEc img") as HTMLImageElement | null)?.src ?? "",
              rating: document.querySelector(".Bd93Zb .fontDisplayLarge")?.textContent ?? "",
              category: document.querySelector(".DkEaL")?.textContent ?? "",
            }));

            detailedLocations.push({ ...location, ...data });
          } catch (error) {
            console.error(`Error fetching details for ${location.name}:`, error);
          } finally {
            await detailPage.close();
          }
        }

        // Guardar en la base de datos con Prisma en paralelo
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
            email: ('email' in location && location.email) ? location.email : `no-email-${Date.now()}@example.com`,
            operationId,
            category: location.category || "Unknown Category",
          })),
          skipDuplicates: true,
        });

        // Devolver registros guardados
        return db.leads.findMany({ where: { operationId } });

      } catch (error) {
        console.error("Scraping error:", error);
        throw new Error(`Scraping failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await browser.close();
      }
    }),
});

// Función optimizada para autoscroll
async function autoScroll(page: puppeteer.Page) {
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
