import { createTRPCRouter, publicProcedure } from "../trpc";
import puppeteer from "puppeteer";
import { z } from "zod";

interface Location {
  name: string;
  link: string;
}

export const scrapeRouter = createTRPCRouter({
  scrapeGoogleMaps: publicProcedure
    .input(z.object({ query: z.string() }))
    .mutation(async ({ input }) => {
      const searchQuery = input.query;
      const url = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;
      console.log("URL", url)

      const browser = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: true,
      });
      const page = await browser.newPage();
      // await page.goto(url, { waitUntil: "networkidle2" });
      await page.goto(url);
      //await page.waitForTimeout(5000); // 5 Sekunden Verzögerung
      await page.waitForSelector('.Nv2PK', { timeout: 6000 });

      // Scrollen, um mehr Ergebnisse zu laden
      let previousHeight: number | null = null;
      for (let i = 0; i < 5; i++) {
        previousHeight = await page.evaluate(() => document.body.scrollHeight);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        //await page.waitForTimeout(3000);
        const newHeight = await page.evaluate(() => document.body.scrollHeight);
        if (newHeight === previousHeight) break;
      }

      // Ergebnisse extrahieren
      const locations: Location[] = await page.evaluate(() => {
        const results: Location[] = [];
        console.log('Google Results', results);
        document.querySelectorAll(".Nv2PK").forEach((el) => {
          const name = (el.querySelector(".qBF1Pd") as HTMLElement)?.innerText || "N/A";
          const link = (el.querySelector("a") as HTMLAnchorElement)?.href || "N/A";
          results.push({ name, link });
        });
        return results;
      });

      await browser.close();

      return locations;
    }),
});
