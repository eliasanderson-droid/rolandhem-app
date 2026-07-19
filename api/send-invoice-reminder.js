import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

webpush.setVapidDetails(
  `mailto:${process.env.WEB_PUSH_EMAIL}`,
  process.env.VITE_WEB_PUSH_PUBLIC_KEY,
  process.env.WEB_PUSH_PRIVATE_KEY
);

export default async function handler(req, res) {
  const auth = req.headers["authorization"];
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).end();

  const now = new Date();
  const today = now.getDate();
  const month = now.getMonth() + 1;

  const { data: settings, error: settingsErr } = await supabase
    .from("property_notification_settings")
    .select("property_id, invoice_reminder_day, invoice_reminder_frequency, properties(name)");
  if (settingsErr) return res.status(500).json({ error: settingsErr.message });

  const dueProperties = (settings || []).filter(s => {
    if (s.invoice_reminder_day !== today) return false;
    const freq = s.invoice_reminder_frequency || 1;
    return (month - 1) % freq === 0;
  });

  if (dueProperties.length === 0) return res.status(200).json({ skipped: true, today, month });

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
  }

  res.status(200).json({ sent, properties: dueProperties.map(p => p.properties?.name) });
}
