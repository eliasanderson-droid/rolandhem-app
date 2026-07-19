// api/send-invoice-reminder.js
// Körs automatiskt varje dag av Vercel Cron (se vercel.json).
// Varje fastighet har ett exakt datum (next_reminder_date) för nästa påminnelse.
// När det datumet är idag: skicka notis, och räkna fram nästa datum utifrån
// frekvensen (varje/varannan/var tredje månad) och spara det för nästa gång.

import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

webpush.setVapidDetails(
  `mailto:${process.env.WEB_PUSH_EMAIL}`,
  process.env.VITE_WEB_PUSH_PUBLIC_KEY,
  process.env.WEB_PUSH_PRIVATE_KEY
);

function addMonths(dateStr, months) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

export default async function handler(req, res) {
  const auth = req.headers["authorization"];
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).end();

  const todayStr = new Date().toISOString().slice(0, 10);

  const { data: settings, error: settingsErr } = await supabase
    .from("property_notification_settings")
    .select("property_id, next_reminder_date, invoice_reminder_frequency, properties(name)");
  if (settingsErr) return res.status(500).json({ error: settingsErr.message });

  const dueProperties = (settings || []).filter(s => s.next_reminder_date === todayStr);

  if (dueProperties.length === 0) return res.status(200).json({ skipped: true, today: todayStr });

  const { data: subs, error: subsErr } = await supabase.from("push_subscriptions").select("*");
  if (subsErr) return res.status(500).json({ error: subsErr.message });

  let sent = 0;
  for (const prop of dueProperties) {
    const payload = JSON.stringify({
      title: "Dags att skicka ut hyresavier",
      body: `Det är dags att generera och skicka ut hyresavier för ${prop.properties?.name || "en fastighet"}.`,
      url: "/",
    });
    const results = await Promise.allSettled(
      (subs || []).map(s =>
        webpush
          .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
          .catch(async err => {
            if (err.statusCode === 410 || err.statusCode === 404) {
              await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
            }
          })
      )
    );
    sent += results.length;

    // Räkna fram och spara nästa datum, utifrån fastighetens egen frekvens.
    const freq = prop.invoice_reminder_frequency || 1;
    const next = addMonths(prop.next_reminder_date, freq);
    await supabase.from("property_notification_settings").update({ next_reminder_date: next }).eq("property_id", prop.property_id);
  }

  res.status(200).json({ sent, properties: dueProperties.map(p => p.properties?.name) });
}
