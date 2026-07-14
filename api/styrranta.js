// api/styrranta.js
// Vercel serverless-funktion: hämtar styrräntan server-side (ingen CORS-begränsning)
// och skickar vidare till frontend. Cache:as i 1 timme för att inte belasta Riksbanken.

export default async function handler(req, res) {
  try {
    const r = await fetch("https://api.riksbank.se/swea/v1/Observations/Latest/ByGroup/2");
    if (!r.ok) throw new Error("Riksbanken svarade " + r.status);
    const list = await r.json();
    const rate = list.find(x => x.seriesId === "SECBREPOEFF");
    if (!rate) throw new Error("Hittade ingen styrränta i svaret");

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=600");
    res.status(200).json(rate);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
