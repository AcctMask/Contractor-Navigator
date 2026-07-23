export type UniversalIntakeResult = {
  customerName: string | null
  customerPhone: string | null
  customerEmail: string | null
  address1: string | null
  city: string | null
  state: string | null
  zip: string | null
  notes: string | null
}

const FIELD_LABEL_PATTERN =
  "(?:customer name|client name|homeowner name|insured name|contact name|name|" +
  "customer phone|client phone|homeowner phone|insured phone|contact phone|phone|cell|" +
  "customer email|client email|homeowner email|insured email|contact email|email|" +
  "property address|service address|job address|customer address|loss location|risk address|address|" +
  "city|state|zip|postal code|" +
  "request|service requested|work requested|notes|comments|message|description)"

const STREET_SUFFIX_PATTERN =
  "(?:aly|alley|ave|avenue|blvd|boulevard|cir|circle|ct|court|dr|drive|hwy|highway|" +
  "ln|lane|pkwy|parkway|pl|place|rd|road|st|street|ter|terrace|trl|trail|way)"

export function cleanIntakeValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }

  const result = String(value)
    .replace(/<mailto:[^>]+>/gi, "")
    .replace(/mailto:/gi, "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()

  return result.length ? result : null
}

export function intakeTextLines(text: string): string[] {
  return String(text || "")
    .replace(/<mailto:[^>]+>/gi, "")
    .replace(/mailto:/gi, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function normalizeIntakeFieldBoundaries(text: string): string {
  return String(text || "")
    .replace(
      new RegExp(
        `\\s*(?:,|/|\\|)?\\s+(?=${FIELD_LABEL_PATTERN}\\s*[:#-])`,
        "gi"
      ),
      "\n"
    )
    .replace(
      new RegExp(
        `([^\\n])\\s+(?=${FIELD_LABEL_PATTERN}\\s*[:#-])`,
        "gi"
      ),
      "$1\n"
    )
}

export function extractIntakeLabeledValue(
  text: string,
  labels: string
): string | null {
  const normalized = normalizeIntakeFieldBoundaries(text)

  const match = normalized.match(
    new RegExp(
      `(?:${labels})\\s*[:#-]\\s*([^\\n\\r,|/]+)`,
      "i"
    )
  )

  return cleanIntakeValue(match?.[1])
}

export function normalizeUsPhone(
  value: string | null
): string | null {
  if (!value) {
    return null
  }

  const digits = value.replace(/\D/g, "")

  if (digits.length === 10) {
    return digits
  }

  if (
    digits.length === 11 &&
    digits.startsWith("1")
  ) {
    return digits.slice(1)
  }

  return null
}

export function extractIntakePhone(
  text: string
): string | null {
  const labeled = extractIntakeLabeledValue(
    text,
    "customer phone|client phone|homeowner phone|insured phone|contact phone|phone|cell"
  )

  const normalizedLabeled = normalizeUsPhone(labeled)

  if (normalizedLabeled) {
    return normalizedLabeled
  }

  const match = text.match(
    /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/
  )

  return normalizeUsPhone(match?.[0] || null)
}

function isExcludedEmail(value: string | null): boolean {
  return Boolean(
    value &&
      (
        /@g2groofing\.com$/i.test(value) ||
        /@(?:[^@\s]+\.)?resend\.(?:com|dev)$/i.test(value)
      )
  )
}

export function extractExternalIntakeEmail(
  text: string
): string | null {
  const labeled = extractIntakeLabeledValue(
    text,
    "customer email|client email|homeowner email|insured email|contact email|email"
  )

  if (
    labeled &&
    /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(labeled) &&
    !isExcludedEmail(labeled)
  ) {
    return labeled
  }

  const matches =
    text.match(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
    ) || []

  for (const match of matches) {
    const candidate = cleanIntakeValue(match)

    if (
      candidate &&
      !isExcludedEmail(candidate)
    ) {
      return candidate
    }
  }

  return null
}

function looksLikeStreet(line: string): boolean {
  return new RegExp(
    `^\\d+[A-Z]?(?:[- ]\\d+)?\\s+.+\\b${STREET_SUFFIX_PATTERN}\\.?$`,
    "i"
  ).test(line)
}

function extractEmbeddedStreet(
  text: string
): string | null {
  const match = String(text || "").match(
    new RegExp(
      `\\b(\\d+[A-Z]?(?:[- ]\\d+)?\\s+(?:[A-Z0-9.'-]+\\s+){0,7}${STREET_SUFFIX_PATTERN}\\.?)\\b`,
      "i"
    )
  )

  return cleanIntakeValue(match?.[1])
}

function extractInlinePropertyAddress(
  text: string
): {
  address1: string | null
  city: string | null
  state: string | null
  zip: string | null
} | null {
  const normalized = String(text || "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  const streetPattern =
    `(\\d+[A-Z]?(?:[- ]\\d+)?\\s+` +
    `(?:[A-Z0-9.'-]+\\s+){0,7}` +
    `${STREET_SUFFIX_PATTERN}\\.?)`

  const completeAddress = normalized.match(
    new RegExp(
      `${streetPattern}\\s*,?\\s+` +
      `([A-Za-z][A-Za-z .'-]{1,60}?)` +
      `\\s*,?\\s+([A-Z]{2})` +
      `(?:\\s+(\\d{5}(?:-\\d{4})?))?\\b`,
      "i"
    )
  )

  if (completeAddress) {
    return {
      address1: cleanIntakeValue(completeAddress[1]),
      city: cleanIntakeValue(completeAddress[2]),
      state: cleanIntakeValue(completeAddress[3]),
      zip: cleanIntakeValue(completeAddress[4]),
    }
  }

  const contextualAddress = normalized.match(
    new RegExp(
      `(?:subject\\s*:|re\\s*:|new\\s+document\\s+for|` +
      `document\\s+for|job\\s+at|property\\s+at|` +
      `upload\\s+(?:this\\s+)?for|for|at)\\s+` +
      `${streetPattern}` +
      `(?:\\s*,?\\s+([A-Za-z][A-Za-z.'-]*))?`,
      "i"
    )
  )

  if (contextualAddress) {
    return {
      address1: cleanIntakeValue(contextualAddress[1]),
      city:
        cleanIntakeValue(contextualAddress[2])
          ?.replace(/[.,]+$/, "") || null,
      state: "FL",
      zip: null,
    }
  }

  return null
}

function parseLocalityLine(line: string): {
  city: string | null
  state: string | null
  zip: string | null
} | null {
  const full = line.match(
    /^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i
  )

  if (full) {
    return {
      city: cleanIntakeValue(full[1]),
      state: cleanIntakeValue(full[2]),
      zip: cleanIntakeValue(full[3]),
    }
  }

  const cityState = line.match(
    /^(.+?),\s*([A-Z]{2})$/i
  )

  if (cityState) {
    return {
      city: cleanIntakeValue(cityState[1]),
      state: cleanIntakeValue(cityState[2]),
      zip: null,
    }
  }

  const cityOnly = line.match(
    /^[A-Za-z][A-Za-z .'-]{1,60}$/
  )

  if (cityOnly) {
    return {
      city: cleanIntakeValue(line),
      state: "FL",
      zip: null,
    }
  }

  return null
}

function looksLikePersonName(line: string): boolean {
  const candidate = String(line || "").trim()

  if (
    /^(from|to|subject|date|sent|phone|email|address|city|state|zip|notes|message|attachment)\s*:/i.test(
      candidate
    )
  ) {
    return false
  }

  if (
    /@|https?:\/\/|www\.|\d{3}[\s.-]?\d{3}[\s.-]?\d{4}|^\d/i.test(
      candidate
    )
  ) {
    return false
  }

  if (
    /\b(llc|l\.l\.c\.?|inc\.?|incorporated|corp\.?|corporation|company|co\.?|roofing|construction|contracting|contractor|builders?|development|management|properties|property|association|hoa|condominium|church|department|office|sales|estimating|estimate|project|projects|insurance|adjuster|adjusting|claims?|team)\b/i.test(
      candidate
    )
  ) {
    return false
  }

  return /^[A-Za-z][A-Za-z'.-]+(?:\s+[A-Za-z][A-Za-z'.-]+){1,3}$/.test(
    candidate
  )
}

export function extractUniversalProperty(
  text: string
): {
  customerName: string | null
  address1: string | null
  city: string | null
  state: string | null
  zip: string | null
  consumedLines: Set<number>
} {
  const normalized = normalizeIntakeFieldBoundaries(text)

  const explicitAddress = extractIntakeLabeledValue(
    normalized,
    "property address|service address|job address|customer address|loss location|risk address|address"
  )

  const explicitCity = extractIntakeLabeledValue(
    normalized,
    "city"
  )

  const explicitState = extractIntakeLabeledValue(
    normalized,
    "state"
  )

  const explicitZip = extractIntakeLabeledValue(
    normalized,
    "zip|postal code"
  )

  const explicitName = extractIntakeLabeledValue(
    normalized,
    "customer name|client name|homeowner name|insured name|contact name|name"
  )

  if (explicitAddress) {
    const oneLine = explicitAddress.match(
      /^(.+?),\s*([^,]+),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i
    )

    if (oneLine) {
      return {
        customerName: explicitName,
        address1: cleanIntakeValue(oneLine[1]),
        city: cleanIntakeValue(oneLine[2]),
        state: cleanIntakeValue(oneLine[3]),
        zip: cleanIntakeValue(oneLine[4]),
        consumedLines: new Set<number>(),
      }
    }

    return {
      customerName: explicitName,
      address1: explicitAddress,
      city: explicitCity,
      state: explicitState || "FL",
      zip: explicitZip,
      consumedLines: new Set<number>(),
    }
  }

  const lines = intakeTextLines(normalized)

  for (
    let index = 0;
    index < lines.length;
    index += 1
  ) {
    const street = lines[index]

    if (!looksLikeStreet(street)) {
      continue
    }

    const locality = parseLocalityLine(
      lines[index + 1] || ""
    )

    if (!locality) {
      continue
    }

    const precedingLine =
      index > 0 ? lines[index - 1] : ""

    const customerName =
      explicitName ||
      (
        looksLikePersonName(precedingLine)
          ? cleanIntakeValue(precedingLine)
          : null
      )

    const consumedLines = new Set<number>([
      index,
      index + 1,
    ])

    if (
      customerName &&
      index > 0 &&
      cleanIntakeValue(precedingLine) === customerName
    ) {
      consumedLines.add(index - 1)
    }

    return {
      customerName,
      address1: cleanIntakeValue(street),
      city: locality.city,
      state: locality.state || "FL",
      zip: locality.zip,
      consumedLines,
    }
  }

  const inlineProperty =
    extractInlinePropertyAddress(normalized)

  if (inlineProperty?.address1) {
    return {
      customerName: explicitName,
      address1: inlineProperty.address1,
      city: inlineProperty.city || explicitCity,
      state:
        inlineProperty.state ||
        explicitState ||
        "FL",
      zip: inlineProperty.zip || explicitZip,
      consumedLines: new Set<number>(),
    }
  }

  const embeddedStreet =
    extractEmbeddedStreet(normalized)

  if (embeddedStreet) {
    return {
      customerName: explicitName,
      address1: embeddedStreet,
      city: explicitCity,
      state: explicitState || "FL",
      zip: explicitZip,
      consumedLines: new Set<number>(),
    }
  }

  const oneLine = normalized.match(
    /(\d+[A-Z]?(?:[- ]\d+)?\s+[^\n\r,]+),\s*([^,\n\r]+),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/i
  )

  let inferredOneLineName: string | null = null
  const oneLineConsumedLines = new Set<number>()

  if (oneLine?.[0]) {
    const lines = intakeTextLines(normalized)
    const addressIndex = lines.findIndex((line) =>
      line.toLowerCase().includes(
        String(oneLine[1] || "").trim().toLowerCase()
      )
    )

    if (addressIndex > 0) {
      const precedingLine = lines[addressIndex - 1]

      if (looksLikePersonName(precedingLine)) {
        inferredOneLineName = cleanIntakeValue(precedingLine)
        oneLineConsumedLines.add(addressIndex - 1)
      }
    }

    if (addressIndex >= 0) {
      oneLineConsumedLines.add(addressIndex)
    }
  }

  return {
    customerName: explicitName || inferredOneLineName,
    address1: cleanIntakeValue(oneLine?.[1]),
    city: cleanIntakeValue(oneLine?.[2]) || explicitCity,
    state:
      cleanIntakeValue(oneLine?.[3]) ||
      explicitState ||
      (
        oneLine?.[1] || explicitAddress
          ? "FL"
          : null
      ),
    zip: cleanIntakeValue(oneLine?.[4]) || explicitZip,
    consumedLines: oneLineConsumedLines,
  }
}

function extractForwardedSenderName(
  text: string
): string | null {
  const match = text.match(
    /from:\s*"?([^"<\n\r]+)"?\s*<[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}>/i
  )

  return cleanIntakeValue(match?.[1])
}

function extractUniversalNotes(
  text: string,
  parsed: Omit<UniversalIntakeResult, "notes">,
  consumedLines: Set<number>
): string | null {
  const explicit = extractIntakeLabeledValue(
    text,
    "request|service requested|work requested|notes|comments|message|description"
  )

  if (explicit) {
    return explicit
  }

  const lines = intakeTextLines(
    normalizeIntakeFieldBoundaries(text)
  )

  const notes = lines.filter((line, index) => {
    if (consumedLines.has(index)) {
      return false
    }

    if (
      /^(begin forwarded message|from:|to:|subject:|date:|sent:|cc:|bcc:)/i.test(
        line
      )
    ) {
      return false
    }

    if (
      parsed.customerName &&
      cleanIntakeValue(line) === parsed.customerName
    ) {
      return false
    }

    if (
      parsed.customerPhone &&
      normalizeUsPhone(line) === parsed.customerPhone
    ) {
      return false
    }

    if (
      parsed.customerEmail &&
      line.toLowerCase().includes(
        parsed.customerEmail.toLowerCase()
      )
    ) {
      return false
    }

    if (
      /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(
        line
      )
    ) {
      return false
    }

    if (
      /^(customer name|client name|homeowner name|insured name|contact name|name|customer phone|client phone|homeowner phone|insured phone|contact phone|phone|cell|customer email|client email|homeowner email|insured email|contact email|email|property address|service address|job address|customer address|loss location|risk address|address|city|state|zip|postal code)\s*[:#-]/i.test(
        line
      )
    ) {
      return false
    }

    return true
  })

  return cleanIntakeValue(notes.join("\n"))
}

export function parseUniversalIntake(
  text: string
): UniversalIntakeResult {
  const normalized =
    normalizeIntakeFieldBoundaries(text)

  const property =
    extractUniversalProperty(normalized)

  const customerName =
    property.customerName ||
    extractForwardedSenderName(normalized)

  const customerPhone =
    extractIntakePhone(normalized)

  const customerEmail =
    extractExternalIntakeEmail(normalized)

  const baseResult = {
    customerName,
    customerPhone,
    customerEmail,
    address1: property.address1,
    city: property.city,
    state: property.state,
    zip: property.zip,
  }

  return {
    ...baseResult,
    notes: extractUniversalNotes(
      normalized,
      baseResult,
      property.consumedLines
    ),
  }
}
