// api/styrranta.js
// Vercel serverless-funktion: hämtar styrräntan (SWEA-API) + nästa penningpolitiska
// besked (skrapat ur en textrad på riksbank.se, eftersom Riksbanken inte har ett
// strukturerat API för mötesdatum) server-side, ingen CORS-begränsning här.

export default async function handler(req, res) {
  try {
    const r = await fetch("https://api.riksbank.se/swea/v1/Observations/Latest/ByGroup/2");
    if (!r.ok) throw new Error("Riksbanken svarade " + r.status);
    const list = await r.json();
    const rate = list.find(x => x.seriesId === "SECBREPOEFF");
    if (!rate) throw new Error("Hittade ingen styrränta i svaret");

    let nextDecision = null;
    try {
      const front = await fetch("https://www.riksbank.se/sv/");
      const html = await front.text();
      const match = html.match(/Nästa penningpolitiska besked\s+(\d{1,2}\s+\w+\s+\d{4})/i);
      if (match) nextDecision = match[1];
    } catch {
      // Om skrapningen fejlar (t.ex. Riksbanken ändrar sidan) visar frontend bara räntan
    }

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=600");
    res.status(200).json({ ...rate, nextDecision });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
