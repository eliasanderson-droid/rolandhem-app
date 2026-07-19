// api/notify-new-issue.js
// Anropas direkt från appen (client-side) varje gång en ny felanmälan sparas —
// se notifyNewIssue() i App.jsx. Vi använder INTE Supabase Database Webhooks
// (det kräver numera en betald Supabase-nivå), utan skickar anropet själva istället.

import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

webpush.setVapidDetails(
  `mailto:${process.env.WEB_PUSH_EMAIL}`,
  process.env.VITE_WEB_PUSH_PUBLIC_KEY,
  process.env.WEB_PUSH_PRIVATE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const issue = req.body?.record;
    if (!issue) return res.status(400).json({ error: "Ingen data skickades med" });

    let propertyName = "en fastighet";
    if (issue.property_id) {
      const { data: prop } = await supabase.from("properties").select("name").eq("id", issue.property_id).single();
      if (prop) propertyName = prop.name;
    }

    const payload = JSON.stringify({
      title: "Ny felanmälan",
      body: `${propertyName}: ${issue.description || issue.title || "Ny felanmälan har lagts upp"}`,
      url: "/",
    });

    const { data: subs } = await supabase.from("push_subscriptions").select("*");
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

    res.status(200).json({ sent: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
