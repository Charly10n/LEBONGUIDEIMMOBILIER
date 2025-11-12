// api/analyze-ia.js  — version CommonJS (compatible Vercel) avec analyse IA "expert 20 ans" très précise
const OpenAI = require("openai");
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    // --- Parse corps JSON en toute sécurité
    let body = req.body || {};
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const form = body.form;
    if (!form) return res.status(400).json({ error: "Champ 'form' manquant" });

    // --- Calculs utiles pour ancrer le raisonnement
    const prixM2 = (form.prixVente && form.surfaceHab) ? Math.round(form.prixVente / form.surfaceHab) : 0;

    // --- PROMPT ULTRA EXIGEANT (vigilances = chaînes détaillées pour rester compatibles avec le front)
    const prompt = `
Rôle: Tu es un EXPERT IMMOBILIER FRANÇAIS (20 ans). Tu protèges l'acheteur. Style: pro, cash, CHIFFRÉ, actionnable.

Données du bien (JSON):
${JSON.stringify(form, null, 2)}

Donnée calculée:
- prix_m2_calculé: ${prixM2} €/m²

Objectif: produire un DIAGNOSTIC CONCRET "prêt à décider".

Réponds STRICTEMENT en JSON (rien d'autre), format:
{
  "forts": [
    "Avantage concret avec QUANTIFICATION si possible (ex: 'Double vitrage 2015 : -10 à -15% pertes')",
    "... (max 6)"
  ],
  "vigilances": [
    "FORMAT OBLIGATOIRE PAR ÉLÉMENT: Titre — Pourquoi/impact — Preuve à exiger — Estimation coût — Priorité: haute|moyenne|basse",
    "ex: Chauffage élec sol 2005 — conso hivernale élevée vs PAC — Factures Hiver N-1/N-2 + type d'émetteurs — 4–6 k€ si bascule PAC — Priorité: haute",
    "... (max 6)"
  ],
  "ameliorations": [
    {
      "action": "Travaux/optimisation (ex: 'PAC air/eau 8kW + régulation')",
      "impact_dpe": "faible|moyen|fort|+1 classe|+2 classes",
      "gain": "Ordre de grandeur (ex: '-25 à -35% chauffage' ou '+10–15 k€ valeur revente')",
      "roi": "Horizon de retour (ex: '5–7 ans à 0,20 €/kWh')"
    },
    {
      "action": "...",
      "impact_dpe": "...",
      "gain": "...",
      "roi": "..."
    }
  ]
}

RÈGLES:
- Max 6 'forts', max 6 'vigilances', EXACTEMENT 2 'ameliorations'.
- Utilise l'année, le DPE, l'état, travaux <10 ans, double vitrage, piscine/garage, surfaces et le PRIX/M² CALCULÉ.
- Si info manquante: hypothèse PRUDENTE et explicite dans 'Pourquoi/impact'.
- Zéro généralités: toujours un CHIFFRE, une FOURCHETTE, ou un DOCUMENT à exiger.
- Français de France, concis et précis.
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2, // plus déterministe et précis
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Tu es un expert immobilier français très cash, factuel et chiffré. Tu protèges l'acheteur." },
        { role: "user", content: prompt }
      ]
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";

    // --- Parsing + normalisation defensive
    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      return res.status(500).json({ error: "Réponse IA non JSON" });
    }

    // Assure 6/6/2 max et structure attendue par le front (vigilances = strings)
    const forts = Array.isArray(parsed.forts) ? parsed.forts.filter(Boolean).slice(0, 6) : [];
    let vigilances = Array.isArray(parsed.vigilances) ? parsed.vigilances.filter(Boolean).slice(0, 6) : [];

    // Si l'IA renvoie des objets par erreur, on les aplatit en texte
    vigilances = vigilances.map(v => {
      if (typeof v === "string") return v;
      if (v && typeof v === "object") {
        const t = [
          v.intitulé || v.titre || "",
          v.pourquoi || v.impact || "",
          v.preuve_a_demander || v.preuve || "",
          (v.estimation_cout || v.cout || ""),
          v.priorite ? `Priorité: ${v.priorite}` : ""
        ].filter(Boolean).join(" — ");
        return t || "Vérifications techniques à préciser — Priorité: moyenne";
      }
      return String(v || "");
    });

    const amelsRaw = Array.isArray(parsed.ameliorations) ? parsed.ameliorations
                    : Array.isArray(parsed.amels) ? parsed.amels : [];

    const ameliorations = amelsRaw.slice(0, 2).map(a =>
      (typeof a === "string")
        ? { action: a, impact_dpe: null, gain: null, roi: null }
        : {
            action: a.action || "",
            impact_dpe: a.impact_dpe ?? null,
            gain: a.gain ?? null,
            roi: a.roi ?? null
          }
    );

    if (!forts.length || !vigilances.length || ameliorations.length < 2) {
      return res.status(500).json({ error: "Réponse IA incomplète" });
    }

    return res.status(200).json({ forts, vigilances, ameliorations });
  } catch (err) {
    const msg =
      err?.response?.data?.error?.message ||
      err?.error?.message ||
      err?.message ||
      "Erreur serveur IA";
    return res.status(500).json({ error: msg });
  }
};
