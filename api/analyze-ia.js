const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }

  try {
    let body = req.body || {};
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        body = {};
      }
    }

    const form = body.form;
    if (!form) {
      res.status(400).json({ error: "Champ 'form' manquant" });
      return;
    }

    const prompt = `
Tu es un expert immobilier français (20 ans d'expérience), très direct et concret.
Tu aides un acheteur débutant à analyser un bien.

Données du bien (JSON):
${JSON.stringify(form, null, 2)}

Attendu: STRICTEMENT un JSON de la forme:

{
  "forts": [
    "phrase courte, concrète, 1 idée par point",
    "... (6 éléments au total, max)"
  ],
  "vigilances": [
    "risque ou point à vérifier, concret, actionnable",
    "... (6 éléments au total, max)"
  ],
  "ameliorations": [
    {
      "action": "travaux ou optimisation à faire",
      "impact_dpe": "impact probable sur le DPE (ex: '+1 classe', 'faible', 'fort')",
      "gain": "ordre de grandeur sur la facture ou la valeur (ex: '-20% chauffage', '+10k€ valeur revente')"
    },
    {
      "action": "...",
      "impact_dpe": "...",
      "gain": "..."
    }
  ]
}

Contraintes :
- Max 6 points forts, max 6 points de vigilance, exactement 2 améliorations.
- Tu te bases VRAIMENT sur l'âge, le DPE, les travaux récents, l'état, la surface et le prix/m².
- Tu parles comme un pro qui protège son client, pas comme un vendeur.
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Tu es un expert immobilier français très cash, tu protèges l'acheteur."
        },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion.choices[0].message.content;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("Erreur parse JSON IA:", e, raw);
      res.status(500).json({ error: "Réponse IA non JSON" });
      return;
    }

    const forts = Array.isArray(parsed.forts) ? parsed.forts.filter(Boolean).slice(0, 6) : [];
    const vigilances = Array.isArray(parsed.vigilances) ? parsed.vigilances.filter(Boolean).slice(0, 6) : [];
    let amelsRaw =
      Array.isArray(parsed.ameliorations) ? parsed.ameliorations :
      Array.isArray(parsed.amels) ? parsed.amels : [];

    const ameliorations = amelsRaw.slice(0, 2).map((a) =>
      typeof a === "string"
        ? { action: a, impact_dpe: null, gain: null }
        : {
            action: a.action ||
