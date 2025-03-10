import { createTRPCRouter, publicProcedure } from "../trpc";
import puppeteer from "puppeteer";
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
  category?: string;
  email?: string;
};

export const scrapeRouter = createTRPCRouter({
  scrapeLocations: publicProcedure
    .input(z.object({ query: z.string(), operationId: z.string().optional() }))
    .mutation(async ({ input }) => {
      const operationId = input.operationId || `op_${Date.now()}`;
      const url = `https://www.google.com/maps/search/${encodeURIComponent(input.query)}`;

      const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox"],
      });

      try {
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "networkidle2" });

        const cookieBtnSelector = 'button[aria-label="Alle ablehnen"]';
        if (await page.$(cookieBtnSelector)) {
          await page.click(cookieBtnSelector);
        }

        await autoScroll(page);

        const locations: Pick<Location, "name" | "link">[] = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a.hfpxzc')).map((el) => ({
            name: el.getAttribute("aria-label") || "No Name",
            link: (el as HTMLAnchorElement).href,
          }))
        );

        const detailedLocations: Location[] = [];

        for (const location of locations) {
          const detailPage = await browser.newPage();
          await detailPage.goto(location.link, { waitUntil: "networkidle2" });

          const details = await detailPage.evaluate(() => ({
            address: document.querySelector(".CsEnBe .Io6YTe")?.textContent || "",
            phone: document.querySelector('.RcCsl [data-tooltip*="Telefonnummer"] .Io6YTe')?.textContent || "",
            website: (document.querySelector(".RcCsl a.CsEnBe") as HTMLAnchorElement | null)?.href || "",
            opening_time: document.querySelector(".OqCZI .ZDu9vd span span")?.textContent || "",
            img: (document.querySelector(".ZKCDEc img") as HTMLImageElement | null)?.src || "",
            rating: document.querySelector(".Bd93Zb .fontDisplayLarge")?.textContent || "",
            category: document.querySelector(".DkEaL")?.textContent || "Unknown Category",
            email: document.querySelector(".some-email-selector")?.textContent || "",
          }));

          detailedLocations.push({ ...location, ...details });
          await detailPage.close();
        }

        await browser.close();

        // Insertar datos en Prisma DB
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
              typeof location.email === "string" && location.email.trim() !== ""
                ? location.email
                : `no-email-${Date.now()}@example.com`,
            operationId,
            category: location.category,
          })),
          skipDuplicates: true,
        });

        return db.leads.findMany({ where: { operationId } });
    }),
});

// Función para auto-scroll
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
      }, 100);
    });
  });
}
