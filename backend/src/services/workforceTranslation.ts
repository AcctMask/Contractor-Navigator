export type WorkforceLanguage = "en" | "es"

export async function translateWorkforceMessage(input: {
  text: string
  fromLanguage: WorkforceLanguage
  toLanguage: WorkforceLanguage
}): Promise<{
  original: string
  translated: string
  translatedByAi: boolean
}> {
  const original = input.text.trim()
  if (!original) throw new Error("Message cannot be empty")

  if (input.fromLanguage === input.toLanguage) {
    return {
      original,
      translated: original,
      translatedByAi: false,
    }
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("Translation unavailable: OPENAI_API_KEY missing")
  }

  const target =
    input.toLanguage === "es" ? "Spanish" : "English"

  const response = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.WORKFORCE_TRANSLATION_MODEL || "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              `Translate the user's construction-job SMS into ${target}. ` +
              "Preserve names, addresses, numbers, measurements, " +
              "dates, and safety instructions exactly. " +
              "Return only the translation.",
          },
          {
            role: "user",
            content: original,
          },
        ],
      }),
    }
  )

  if (!response.ok) {
    throw new Error(`Translation API failed: ${response.status}`)
  }

  const data: any = await response.json()
  const translated =
    String(data?.choices?.[0]?.message?.content || "").trim()

  if (!translated) {
    throw new Error("Translation API returned empty text")
  }

  return {
    original,
    translated,
    translatedByAi: true,
  }
}


/**
 * Translate an incoming workforce SMS into the recipient's language.
 * Detect the source language from the message itself.
 * Never silently return untranslated text if translation fails.
 */
export async function translateIncomingWorkforceMessage(input: {
  text: string
  toLanguage: WorkforceLanguage
}): Promise<{
  original: string
  translated: string
  detectedLanguage: WorkforceLanguage
  translatedByAi: boolean
}> {
  const original = input.text.trim()
  if (!original) throw new Error("Message cannot be empty")

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("Incoming translation unavailable: OPENAI_API_KEY missing")
  }

  const target = input.toLanguage === "es" ? "Spanish" : "English"

  async function requestTranslation(retry: boolean) {
    const response = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.WORKFORCE_TRANSLATION_MODEL || "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              `Identify whether this construction-job SMS is English or Spanish. ` +
              `Translate it into ${target} only if necessary. ` +
              `Preserve names, addresses, numbers, measurements, dates, ` +
              `and safety instructions exactly. ` +
              `Return JSON with keys detected_language ("en" or "es") ` +
              `and translated (the final text in ${target}). ` +
              `For short or ambiguous text, choose the most likely language ` +
              `and preserve the original text if it is already ${target}. ` +
              `Use exactly "en" or "es" for detected_language.`,
          },
          {
            role: "user",
            content: original,
          },
        ],
      }),
    }
  )

  if (!response.ok) {
    throw new Error(`Incoming translation API failed: ${response.status}`)
  }

    const data: any = await response.json()
    const content = String(data?.choices?.[0]?.message?.content || "")

    let parsed: any
    try {
      parsed = JSON.parse(content)
    } catch {
      parsed = null
    }

    if (
      !parsed ||
      !["en", "es"].includes(parsed.detected_language) ||
      typeof parsed.translated !== "string" ||
      !parsed.translated.trim()
    ) {
      if (!retry) return requestTranslation(true)
      return requestPlainTextFallback()
    }

    return {
      original,
      translated: parsed.translated.trim(),
      detectedLanguage: parsed.detected_language as WorkforceLanguage,
      translatedByAi: parsed.detected_language !== input.toLanguage,
    }
  }

  async function requestPlainTextFallback() {
    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.WORKFORCE_TRANSLATION_MODEL || "gpt-4o-mini",
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                `Translate this construction-job message into ${target}. ` +
                `If it is already in ${target}, return it unchanged. ` +
                "Preserve names, addresses, numbers, measurements, dates, " +
                "and safety instructions. Return only the final text, " +
                "without JSON, explanations, or quotation marks.",
            },
            {
              role: "user",
              content: original,
            },
          ],
        }),
      }
    )

    if (!response.ok) {
      throw new Error(`Incoming translation fallback API failed: ${response.status}`)
    }

    const data: any = await response.json()
    const translated = String(data?.choices?.[0]?.message?.content || "").trim()

    if (!translated) {
      throw new Error("Incoming translation fallback returned empty text")
    }

    return {
      original,
      translated,
      // Plain-text fallback does not verify the source language.
      // Preserve the existing response contract without claiming detection.
      detectedLanguage: input.toLanguage,
      translatedByAi: translated !== original,
    }
  }

  return requestTranslation(false)
}
