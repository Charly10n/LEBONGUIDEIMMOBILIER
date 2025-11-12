// api/analyze.js — copie simple et fiable de l'analyse IA (CommonJS)
const OpenAI = require("openai");
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  try {
    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const form = body.form;
    if (!form) return res.status(400).json({ error: "Champ 'form' manquant" });

    const prixM2 = (form.prixVente && form.surfaceHab) ? Math.round(form.prixVente / form.surfaceHab) : 0;
    const annee = Number(form.anneeConstr || 0);
    const etat = String(form.etatGeneral || "").toLowerCase();
    const isNeuf = (annee >= 2021) || etat.includes("neuf") || etat.includes("récemment");

    const contexteNeuf = `
Si NEUF/RE2020 (année ≥ 2021 OU état "neuf/récemment rénovée") :
- q4Pa-surf ≤ 0,6 m³/h·m² (maison), Cep,nr très bas, Bbio conforme.
- Chauffage: PAC SCOP ~3,5–4,5 ; ECS: CET COP ~2–3 ; Ventilation hygro B/DF.
- DPE attendu: A. Preuves: PV blower door, attestation RE2020, Consuel, DOE, DO, décennale, notices équipements.
- Chiffrer conso (kWh/an, €/an à 0,20 €/kWh) et dérives si défaut.
`;
    const contexteAncien = `
RT2012 (2013–2020): q4Pa-surf ≤ 0,6–0,8, attestation RT2012, PAC/CET fréquents.
Ancien (<2013): ponts thermiques, combles ≥30 cm, menuiseries, humidité, PAC conseillée.
`;

    const prompt = `
Rôle: EXPERT IMMOBILIER FR (20 ans). Tu protèges l'acheteur. Style: pro, cash, chiffré.

Données du bien:
${JSON.stringify(form, null, 2)}

Calculs:
- prix_m2_calculé: ${prixM2} €/m²
- profil_bien: ${isNeuf ? "NEUF/RE2020 présumé" : (annee >= 2013 ? "RT2012/2013-2020 présumé" : "Ancien")}

${isNeuf ? contexteNeuf : contexteAncien}

Réponds STRICTEMENT en JSON:
{
  "forts": ["avantage concret + chiffre", "... (max 6)"],
  "vigilances": [
    "Titre — Pourquoi/impact (chiffres) — Preuve à exiger — Estimation coût — Priorité: haute|moyenne|basse",
    "... (max 6)"
  ],
  "ameliorations": [
    { "action": "travaux précis", "impact_dpe": "faible|moyen|fort|+1 classe|+2 classes", "gain": "ordre de grandeur", "roi": "retour estimé" },
    { "action": "...", "impact_dpe": "...", "gain": "...", "roi": "..." }
  ]
}
- Max 6/6, EXACT 2 améliorations. Toujours chiffres, docs à exiger, décisions actionnables.
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Tu es un expert immobilier français très cash, factuel et chiffré. Tu protèges l'acheteur." },
        { role: "user", content: prompt }
      ]
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";
    let parsed; try { parsed = JSON.parse(raw); } catch { return res.status(500).json({ error: "Réponse IA non JSON" }); }

    const forts = Array.isArray(parsed.forts) ? parsed.forts.filter(Boolean).slice(0,6) : [];
    let vigilances = Array.isArray(parsed.vigilances) ? parsed.vigilances.filter(Boolean).slice(0,6) : [];
    vigilances = vigilances.map(v => typeof v === "string" ? v :
      [v?.intitulé||v?.titre||"", v?.pourquoi||v?.impact||"", v?.preuve_a_demander||v?.preuve||"", v?.estimation_cout||v?.cout||"", v?.priorite?`Priorité: ${v.priorite}`:""]
        .filter(Boolean).join(" — ") || "Vérifications techniques à préciser — Priorité: moyenne");

    const amelsRaw = Array.isArray(parsed.ameliorations) ? parsed.ameliorations
                    : Array.isArray(parsed.amels) ? parsed.amels : [];
    const ameliorations = amelsRaw.slice(0,2).map(a =>
      typeof a === "string" ? { action:a, impact_dpe:null, gain:null, roi:null } :
      { action:a.action||"", impact_dpe:a.impact_dpe??null, gain:a.gain??null, roi:a.roi??null }
    );

    if (!forts.length || !vigilances.length || ameliorations.length < 2)
      return res.status(500).json({ error: "Réponse IA incomplète" });

    res.status(200).json({ forts, vigilances, ameliorations });
  } catch (err) {
    const msg = err?.response?.data?.error?.message || err?.message || "Erreur serveur IA";
    res.status(500).json({ error: msg });
  }
};
