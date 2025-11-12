import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }

  try {
    let body = req.body || {};
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const form = body.form;
    if (!form) {
      res.status(400).json({ error: "Champ 'form' manquant" });
      return;
    }

    const prompt = `
Tu es un expert immobilier français (20 ans d'expérience), très direct et concret.
Données du bien (JSON):
${JSON.stringify(form, null, 2)}

Réponds STRICTEMENT en JSON:
{
  "forts": ["...", "...", "...", "...", "...", "..."],
  "vigilances": ["...", "...", "...", "...", "...", "..."],
  "ameliorations": [
    { "action": "...", "impact_dpe": "...", "gain": "..." },
    { "action": "...", "impact_dpe": "...", "gain": "..." }
  ]
}
Règles: max 6/6 et exactement 2 améliorations, concret et actionnable.
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",                       // <- modèle sûr et dispo
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Tu es un expert immobilier français très cash, tu protèges l'acheteur." },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) {
      console.error("Réponse IA non JSON:", raw);
      return res.status(500).json({ error: "Réponse IA non JSON" });
    }

    const forts = Array.isArray(parsed.forts) ? parsed.forts.filter(Boolean).slice(0, 6) : [];
    const vigilances = Array.isArray(parsed.vigilances) ? parsed.vigilances.filter(Boolean).slice(0, 6) : [];
    const amelsRaw = Array.isArray(parsed.ameliorations) ? parsed.ameliorations
                    : Array.isArray(parsed.amels) ? parsed.amels : [];
    const ameliorations = amelsRaw.slice(0, 2).map(a =>
      typeof a === "string" ? { action: a, impact_dpe: null, gain: null }
                            : { action: a.action || "", impact_dpe: a.impact_dpe ?? null, gain: a.gain ?? null }
    );

    if (!forts.length || !vigilances.length || ameliorations.length < 2) {
      return res.status(500).json({ error: "Réponse IA incomplète" });
    }

    res.status(200).json({ forts, vigilances, ameliorations });
  } catch (err) {
    console.error("Erreur /api/analyze-ia:", err);
    const msg =
      err?.response?.data?.error?.message ||
      err?.error?.message ||
      err?.message ||
      "Erreur serveur IA";
    res.status(500).json({ error: msg });
  }
}
