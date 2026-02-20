import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LANGUAGE_NAMES: Record<string, string> = {
  ja: "Japanese",
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  ru: "Russian",
  ar: "Arabic",
  hi: "Hindi",
  th: "Thai",
  vi: "Vietnamese",
  id: "Indonesian",
  tr: "Turkish",
  it: "Italian",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sourceJson, targetLang } = await req.json();

    if (!sourceJson || !targetLang) {
      return new Response(
        JSON.stringify({ error: "sourceJson and targetLang are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const langName = LANGUAGE_NAMES[targetLang];
    if (!langName) {
      return new Response(
        JSON.stringify({ error: `Unsupported language: ${targetLang}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const sourceStr = typeof sourceJson === "string" ? sourceJson : JSON.stringify(sourceJson, null, 2);

    const systemPrompt = `You are a professional translator for a laptop anti-theft security app called "MeerCOP" (미어캅). 
Translate the following JSON from Korean to ${langName}.

Rules:
1. Return ONLY valid JSON — no markdown, no explanation, no code blocks.
2. Keep all JSON keys exactly the same (do not translate keys).
3. Translate all string values naturally and professionally.
4. Keep brand names unchanged: "MeerCOP", "MeerCOP ON/OFF".
5. Keep technical terms recognizable: "WebRTC", "SDP", "USB", "GPS", "Wi-Fi", "PIN", "PWA", "IP".
6. Keep emoji and special characters (🚨, 📍, 📷, etc.) unchanged.
7. Keep HTML tags like <strong> unchanged.
8. Keep template variables like {{count}}, {{percent}}, {{name}}, {{progress}} unchanged.
9. Keep "ON", "OFF" in English as they are UI button labels.
10. Adapt the tone to be natural in ${langName} — not word-by-word translation.`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: sourceStr },
          ],
          temperature: 0.1,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway returned ${response.status}`);
    }

    const data = await response.json();
    let translatedText = data.choices?.[0]?.message?.content || "";

    // Clean up any markdown code block wrappers
    translatedText = translatedText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    // Validate it's valid JSON
    const parsed = JSON.parse(translatedText);

    return new Response(JSON.stringify({ translation: parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("translate-i18n error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Translation failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
