import { PDFDocument, StandardFonts, rgb } from "pdf-lib"

export async function generateWeatherEvidencePdf(report: any): Promise<Buffer> {
  if (!report?.ok || !report?.report_id || !report?.property) {
    throw new Error("Invalid weather evidence report")
  }

  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page = pdf.addPage([612, 792])
  const ink = rgb(0.08, 0.16, 0.27)

  const clean = (value: unknown) =>
    String(value ?? "").replace(/[^\x20-\x7E]/g, " ").slice(0, 110)

  page.drawText("GOOD2GO ROOFING & CONSTRUCTION", {
    x: 40, y: 740, size: 17, font: bold, color: ink
  })

  page.drawText("PROFESSIONAL WEATHER EVIDENCE REPORT", {
    x: 40, y: 713, size: 12, font: bold, color: ink
  })

  let y = 675
  const line = (label: string, value: unknown) => {
    page.drawText(clean(`${label}: ${value ?? "N/A"}`), {
      x: 40, y, size: 10, font, color: ink
    })
    y -= 23
  }

  line("Report ID", report.report_id)
  line("Generated", report.generated_at)
  line("Customer", report.customer?.name)
  line("Property", report.property.formatted_address || report.property.address)
  line("Period", `${report.search?.start} to ${report.search?.end}`)
  line("Radius", `${report.search?.radius_miles} miles`)


  y -= 15
  page.drawText("WEATHER EVIDENCE SUMMARY", {
    x: 40, y, size: 13, font: bold, color: ink
  })
  y -= 28

  const summary = report.weather_evidence_summary || {}
  line("Events within radius", summary.events_within_radius ?? 0)
  line("Hail observations", summary.hail_observations ?? 0)
  line("Wind observations", summary.wind_observations ?? 0)
  line("Largest hail (inches)", summary.largest_hail_in ?? "None reported")
  line("Highest wind (mph)", summary.highest_wind_mph ?? "None reported")

  y -= 10
  page.drawText("SOURCE INFORMATION", {
    x: 40, y, size: 12, font: bold, color: ink
  })
  y -= 22

  for (const source of report.sources_used || []) {
    line("Source", source)
  }

  page.drawText(
    "Nearby weather reports do not establish property damage.",
    { x: 40, y: 75, size: 9, font, color: ink }
  )


  const events = Array.isArray(report.events) ? report.events : []
  let eventPage = pdf.addPage([612, 792])
  let eventY = 745

  const eventLine = (value: unknown) => {
    if (eventY < 75) {
      eventPage = pdf.addPage([612, 792])
      eventY = 745
    }
    eventPage.drawText(clean(value), {
      x: 40, y: eventY, size: 9, font, color: ink
    })
    eventY -= 18
  }

  eventLine("DATED WEATHER OBSERVATIONS")
  eventY -= 12

  if (!events.length) {
    eventLine("No qualifying observations returned for the selected search.")
  }

  for (const event of events) {
    const measurement = event.hail_size_in != null
      ? `${event.hail_size_in} inch hail`
      : event.wind_mph != null
        ? `${event.wind_mph} mph wind`
        : "Measurement unavailable"

    eventLine(`${event.date || "Date unavailable"} | ${measurement}`)
    eventLine(`${event.city || "Location unavailable"} | ${event.distance_miles ?? "?"} miles`)
    eventLine(`Source: ${event.source || "IEM"} | ID: ${event.product_id || event.id || "N/A"}`)
    eventY -= 12
  }


  const lat = Number(report.property.lat)
  const lng = Number(report.property.lng)
  const radius = Number(report.search?.radius_miles)

  if (Number.isFinite(lat) && Number.isFinite(lng) &&
      Number.isFinite(radius) && radius > 0) {
    const map = pdf.addPage([612, 792])
    map.drawText("PROPERTY-CENTERED EVENT LOCATION DIAGRAM", {
      x: 40, y: 745, size: 13, font: bold, color: ink
    })

    const cx = 306, cy = 405, scale = 235 / radius
    map.drawCircle({
      x: cx, y: cy, size: 235,
      borderColor: ink, borderWidth: 1
    })

    map.drawCircle({
      x: cx, y: cy, size: 5, color: rgb(0, 0.35, 0.8)
    })

    for (const event of events) {
      const eLat = Number(event.lat)
      const eLng = Number(event.lng)
      if (!Number.isFinite(eLat) || !Number.isFinite(eLng)) continue

      const north = (eLat - lat) * 69
      const east = (eLng - lng) * 69 * Math.cos(lat * Math.PI / 180)
      const x = cx + east * scale
      const y = cy + north * scale

      if (Math.hypot(x - cx, y - cy) > 235) continue

      map.drawCircle({
        x, y, size: 4,
        color: event.hail_size_in != null
          ? rgb(0.85, 0.25, 0.15)
          : rgb(0.9, 0.65, 0.1)
      })
    }

    map.drawText("Blue: property | Red: hail | Gold: wind", {
      x: 40, y: 115, size: 10, font, color: ink
    })
    map.drawText("Approximate geographic plot; not a street map.", {
      x: 40, y: 95, size: 9, font, color: ink
    })
    map.drawText("Reported nearby weather does not prove property damage.", {
      x: 40, y: 75, size: 9, font, color: ink
    })
  }

  return Buffer.from(await pdf.save())
}
