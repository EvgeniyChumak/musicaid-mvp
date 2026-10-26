from __future__ import annotations

from pathlib import Path
from math import hypot

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "musicaid-technical-brief.pdf"

PAGE_W, PAGE_H = A4
MARGIN_X = 17 * mm
MARGIN_TOP = 20 * mm
MARGIN_BOTTOM = 17 * mm
CONTENT_W = PAGE_W - 2 * MARGIN_X

# MusicAID product palette from src/styles.css.
INK = colors.HexColor("#17171B")
MUTED = colors.HexColor("#76737C")
LINE = colors.HexColor("#DFDDD6")
PAPER = colors.HexColor("#F5F3EE")
WHITE = colors.HexColor("#FFFEFB")
GREEN = colors.HexColor("#C9FF63")
GREEN_DARK = colors.HexColor("#4B5C28")
MINT = colors.HexColor("#CCEFE6")
VIOLET = colors.HexColor("#E8E1FF")
AMBER = colors.HexColor("#FFE8A8")
BLUE = colors.HexColor("#DCE9F3")
RED = colors.HexColor("#FFB5AE")


pdfmetrics.registerFont(TTFont("Segoe", r"C:\Windows\Fonts\segoeui.ttf"))
pdfmetrics.registerFont(TTFont("Segoe-Bold", r"C:\Windows\Fonts\segoeuib.ttf"))
pdfmetrics.registerFont(TTFont("Consolas", r"C:\Windows\Fonts\consola.ttf"))
pdfmetrics.registerFont(TTFont("Consolas-Bold", r"C:\Windows\Fonts\consolab.ttf"))


class NumberedCanvasDoc(BaseDocTemplate):
    pass


def page_chrome(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(MARGIN_X, PAGE_H - 12 * mm, PAGE_W - MARGIN_X, PAGE_H - 12 * mm)
    canvas.setFont("Consolas-Bold", 7)
    canvas.setFillColor(INK)
    canvas.drawString(MARGIN_X, PAGE_H - 9 * mm, "MUSICAID / TECHNICAL BRIEF")
    canvas.setFont("Consolas", 7)
    canvas.setFillColor(MUTED)
    canvas.drawRightString(PAGE_W - MARGIN_X, PAGE_H - 9 * mm, "YEVHEN CHUMAK / 26 OCT 2026")
    canvas.line(MARGIN_X, 11 * mm, PAGE_W - MARGIN_X, 11 * mm)
    canvas.drawString(MARGIN_X, 7.2 * mm, "PERFORMANCE ANALYSIS MVP")
    canvas.drawRightString(PAGE_W - MARGIN_X, 7.2 * mm, f"{doc.page}")
    canvas.restoreState()


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    "Kicker", fontName="Consolas-Bold", fontSize=7.5, leading=10,
    textColor=GREEN_DARK, spaceAfter=6, uppercase=True,
))
styles.add(ParagraphStyle(
    "TitleLarge", fontName="Segoe-Bold", fontSize=27, leading=31,
    textColor=INK, spaceAfter=10,
))
styles.add(ParagraphStyle(
    "PageTitle", fontName="Segoe-Bold", fontSize=19, leading=23,
    textColor=INK, spaceAfter=7,
))
styles.add(ParagraphStyle(
    "Lead", fontName="Segoe", fontSize=11, leading=16,
    textColor=MUTED, spaceAfter=12,
))
styles.add(ParagraphStyle(
    "BodyTech", fontName="Segoe", fontSize=8.7, leading=12.2,
    textColor=INK, spaceAfter=7,
))
styles.add(ParagraphStyle(
    "Small", fontName="Segoe", fontSize=7.4, leading=10.2,
    textColor=MUTED,
))
styles.add(ParagraphStyle(
    "SmallStrong", fontName="Segoe-Bold", fontSize=7.5, leading=10,
    textColor=INK,
))
styles.add(ParagraphStyle(
    "TableHeader", fontName="Segoe-Bold", fontSize=7.5, leading=10,
    textColor=WHITE,
))
styles.add(ParagraphStyle(
    "Section", fontName="Consolas-Bold", fontSize=8.5, leading=11,
    textColor=INK, spaceBefore=4, spaceAfter=6,
))
styles.add(ParagraphStyle(
    "Quote", fontName="Segoe", fontSize=9.5, leading=14,
    leftIndent=10, rightIndent=10, textColor=INK,
))
styles.add(ParagraphStyle(
    "BoxLabel", fontName="Consolas-Bold", fontSize=7, leading=9,
    textColor=MUTED,
))
styles.add(ParagraphStyle(
    "BoxText", fontName="Segoe-Bold", fontSize=9, leading=11,
    textColor=INK,
))


def P(text: str, style: str = "BodyTech") -> Paragraph:
    return Paragraph(text, styles[style])


def bullet(text: str) -> Paragraph:
    return Paragraph(f"- {text}", ParagraphStyle(
        "BulletLocal", parent=styles["BodyTech"], leftIndent=9, firstLineIndent=-7,
        spaceAfter=4,
    ))


def section_title(kicker: str, title: str, lead: str | None = None):
    items = [P(kicker.upper(), "Kicker"), P(title, "PageTitle")]
    if lead:
        items.append(P(lead, "Lead"))
    return items


class MetricStrip(Flowable):
    def __init__(self, items, height=55):
        super().__init__()
        self.items = items
        self.height = height

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        return availWidth, self.height

    def draw(self):
        c = self.canv
        gap = 7
        box_w = (self.width - gap * (len(self.items) - 1)) / len(self.items)
        for i, (value, label) in enumerate(self.items):
            x = i * (box_w + gap)
            c.setFillColor(WHITE)
            c.setStrokeColor(LINE)
            c.roundRect(x, 0, box_w, self.height, 6, fill=1, stroke=1)
            c.setFillColor(INK)
            c.setFont("Consolas-Bold", 15)
            c.drawString(x + 10, 28, value)
            c.setFillColor(MUTED)
            c.setFont("Segoe", 7)
            c.drawString(x + 10, 13, label)


def draw_box(c, x, y, w, h, title, subtitle="", fill=WHITE, title_size=8.5):
    c.setFillColor(fill)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.7)
    c.roundRect(x, y, w, h, 5, fill=1, stroke=1)
    c.setFillColor(INK)
    c.setFont("Segoe-Bold", title_size)
    c.drawCentredString(x + w / 2, y + h / 2 + (4 if subtitle else -2), title)
    if subtitle:
        c.setFillColor(MUTED)
        c.setFont("Segoe", 6.4)
        c.drawCentredString(x + w / 2, y + h / 2 - 8, subtitle)


def _filled_arrow_head(c, x, y, dx, dy, size=5.2):
    length = hypot(dx, dy) or 1
    ux, uy = dx / length, dy / length
    px, py = -uy, ux
    base_x, base_y = x - ux * size, y - uy * size
    half = size * 0.48
    path = c.beginPath()
    path.moveTo(x, y)
    path.lineTo(base_x + px * half, base_y + py * half)
    path.lineTo(base_x - px * half, base_y - py * half)
    path.close()
    c.drawPath(path, fill=1, stroke=0)


def polyline_arrow(c, points, label="", label_xy=None):
    c.setStrokeColor(INK)
    c.setFillColor(INK)
    c.setLineWidth(1.05)
    for (x1, y1), (x2, y2) in zip(points, points[1:]):
        c.line(x1, y1, x2, y2)
    (x1, y1), (x2, y2) = points[-2], points[-1]
    _filled_arrow_head(c, x2, y2, x2 - x1, y2 - y1)
    if label:
        lx, ly = label_xy or ((x1 + x2) / 2, (y1 + y2) / 2 + 5)
        label_w = c.stringWidth(label, "Consolas-Bold", 5.8) + 10
        c.setFillColor(PAPER)
        c.roundRect(lx - label_w / 2, ly - 4, label_w, 11, 3, fill=1, stroke=0)
        c.setFillColor(MUTED)
        c.setFont("Consolas-Bold", 5.8)
        c.drawCentredString(lx, ly, label)


def arrow(c, x1, y1, x2, y2, label="", label_xy=None):
    polyline_arrow(c, [(x1, y1), (x2, y2)], label, label_xy)


class ArchitectureDiagram(Flowable):
    def __init__(self, height=252):
        super().__init__()
        self.height = height

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        return availWidth, self.height

    def draw(self):
        c = self.canv
        browser_w = self.width * 0.55
        panel_gap = 48
        server_x = browser_w + panel_gap
        server_w = self.width - server_x
        c.setFont("Consolas-Bold", 7)
        c.setFillColor(MUTED)
        c.drawString(0, self.height - 10, "BROWSER")
        c.drawString(server_x, self.height - 10, "FASTAPI")
        c.setStrokeColor(LINE)
        c.roundRect(0, 0, browser_w, self.height - 20, 7, fill=0, stroke=1)
        c.roundRect(server_x, 0, server_w, self.height - 20, 7, fill=0, stroke=1)

        bw = browser_w - 36
        bx = 18
        box_h = 32
        ys = [self.height - 68, self.height - 110, self.height - 152, self.height - 194]
        draw_box(c, bx, ys[0], bw, box_h, "1. Audio or video", "MP3 / WAV / MP4 / WebM", MINT)
        draw_box(c, bx, ys[1], bw, box_h, "2. Decode and resample", "mono 22.05 kHz", WHITE)
        draw_box(c, bx, ys[2], bw, box_h, "3. Transcribe notes", "Basic Pitch: pitch / onset / duration", VIOLET)
        draw_box(c, bx, ys[3], bw, box_h, "4. Clean note events", "instrument-specific filtering", AMBER)
        for i in range(3):
            arrow(c, bx + bw / 2, ys[i], bx + bw / 2, ys[i + 1] + box_h)

        sx = server_x + 13
        sw = server_w - 26
        sys = [self.height - 80, self.height - 190, 10]
        draw_box(c, sx, sys[0], sw, 42, "Reference data", "MIDI measure and beat map", MINT)
        draw_box(c, sx, sys[1], sw, 42, "6. Align with reference", "key / tempo / sequence", VIOLET)
        draw_box(c, sx, sys[2], sw, 42, "7. Classify and score", "errors / coverage / advice", GREEN)
        arrow(c, sx + sw / 2, sys[0], sx + sw / 2, sys[1] + 42)
        arrow(c, sx + sw / 2, sys[1], sx + sw / 2, sys[2] + 42)
        connector_y = ys[3] + box_h / 2
        connector_x1 = bx + bw
        connector_x2 = sx
        connector_mid = (connector_x1 + connector_x2) / 2
        arrow(c, connector_x1, connector_y, connector_x2, connector_y)
        badge_w, badge_h = 68, 22
        c.setFillColor(INK)
        c.roundRect(
            connector_mid - badge_w / 2,
            connector_y - badge_h / 2,
            badge_w,
            badge_h,
            4,
            fill=1,
            stroke=0,
        )
        c.setFillColor(WHITE)
        c.setFont("Consolas-Bold", 5.5)
        c.drawCentredString(connector_mid, connector_y + 2, "5. POST /api/analyze")
        c.setFont("Consolas", 4.9)
        c.drawCentredString(connector_mid, connector_y - 6, "clean note events")


class FileJourneyDiagram(Flowable):
    def __init__(self, height=438):
        super().__init__()
        self.height = height

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        return availWidth, self.height

    def draw(self):
        c = self.canv
        stages = [
            ("01", "Upload audio or video", "The selected file stays in the browser.", "BROWSER", MINT),
            ("02", "Prepare the sound", "Decode, convert to mono and resample to 22.05 kHz.", "WEB AUDIO", WHITE),
            ("03", "Hear the notes", "Basic Pitch returns pitch, onset, duration and confidence.", "LOCAL ML", VIOLET),
            ("04", "Clean note events", "Instrument-specific rules remove harmonics and fragments.", "BROWSER", AMBER),
            ("05", "Send compact JSON", "POST /api/analyze/{piece} sends notes, not the recording.", "API", INK),
            ("06", "Load the correct score", "FastAPI parses the selected Reference MIDI.", "FASTAPI", MINT),
            ("07", "Compare in two passes", "Match the sequence, adapt key and tempo, then check timing.", "FASTAPI", BLUE),
            ("08", "Explain the result", "Return accuracy, coverage, errors, measures and recommendations.", "UI", GREEN),
        ]
        card_x = 24
        card_w = self.width - 48
        card_h = 42
        gap = 11
        first_y = self.height - card_h - 6

        for index, (number, title, subtitle, owner, fill) in enumerate(stages):
            y = first_y - index * (card_h + gap)
            c.setFillColor(fill)
            c.setStrokeColor(LINE)
            c.setLineWidth(0.7)
            c.roundRect(card_x, y, card_w, card_h, 6, fill=1, stroke=1)

            number_fill = GREEN if fill == INK else INK
            number_text = INK if fill == INK else WHITE
            c.setFillColor(number_fill)
            c.circle(card_x + 22, y + card_h / 2, 11, fill=1, stroke=0)
            c.setFillColor(number_text)
            c.setFont("Consolas-Bold", 6.5)
            c.drawCentredString(card_x + 22, y + card_h / 2 - 2.2, number)

            main_text = WHITE if fill == INK else INK
            sub_text = colors.HexColor("#C7C7C1") if fill == INK else MUTED
            c.setFillColor(main_text)
            c.setFont("Segoe-Bold", 8.8)
            c.drawString(card_x + 44, y + 24, title)
            c.setFillColor(sub_text)
            c.setFont("Segoe", 6.8)
            c.drawString(card_x + 44, y + 11, subtitle)

            c.setFillColor(GREEN if fill == INK else colors.HexColor("#ECE9E1"))
            owner_w = c.stringWidth(owner, "Consolas-Bold", 5.8) + 14
            c.roundRect(card_x + card_w - owner_w - 12, y + 13, owner_w, 16, 4, fill=1, stroke=0)
            c.setFillColor(INK)
            c.setFont("Consolas-Bold", 5.8)
            c.drawCentredString(card_x + card_w - owner_w / 2 - 12, y + 18, owner)

            if index < len(stages) - 1:
                next_y = first_y - (index + 1) * (card_h + gap)
                arrow(c, self.width / 2, y, self.width / 2, next_y + card_h)


class AlgorithmDiagram(Flowable):
    def __init__(self, height=420):
        super().__init__()
        self.height = height

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        return availWidth, self.height

    def draw(self):
        c = self.canv
        gap_x = 34
        col_w = (self.width - gap_x) / 2
        box_h = 40
        left_x = 0
        right_x = col_w + gap_x
        steps = [
            ("1. Validate note events", "Pydantic request model", MINT),
            ("2. Parse reference MIDI", "pitch / time / measure / beat", WHITE),
            ("3. Clean note events", "fragments and onset groups", AMBER),
            ("4. Detect transposition", "LCS over shifts -12 to +12", VIOLET),
            ("5. Pitch-only alignment", "semi-global dynamic programming", WHITE),
            ("6. Estimate tempo", "median ratio and start offset", BLUE),
            ("7. Normalize timeline", "(played - offset) / ratio", WHITE),
            ("8. Pitch + time alignment", "second dynamic programming pass", VIOLET),
            ("9. Classify events", "wrong / missed / extra / timing", AMBER),
            ("10. Score and explain", "accuracy / coverage / recommendations", GREEN),
        ]
        first_y = self.height - 76
        row_gap = 20
        c.setFont("Consolas-Bold", 7)
        c.setFillColor(MUTED)
        c.drawCentredString(left_x + col_w / 2, self.height - 12, "PASS 1 · STEPS 1–5")
        c.drawCentredString(right_x + col_w / 2, self.height - 12, "PASS 2 · STEPS 6–10")
        c.setFillColor(INK)
        c.setFont("Consolas-Bold", 10)
        c.drawCentredString(self.width / 2, self.height - 14, "→")

        left_positions = []
        right_positions = []
        for row in range(5):
            y = first_y - row * (box_h + row_gap)
            left_positions.append(y)
            right_positions.append(y)
            left_title, left_subtitle, left_fill = steps[row]
            right_title, right_subtitle, right_fill = steps[row + 5]
            draw_box(c, left_x, y, col_w, box_h, left_title, left_subtitle, left_fill)
            draw_box(c, right_x, y, col_w, box_h, right_title, right_subtitle, right_fill)
            if row:
                arrow(c, left_x + col_w / 2, left_positions[row - 1], left_x + col_w / 2, y + box_h)
                arrow(c, right_x + col_w / 2, right_positions[row - 1], right_x + col_w / 2, y + box_h)

        c.setFillColor(MUTED)
        c.setFont("Consolas", 6.2)
        c.drawCentredString(
            self.width / 2,
            72,
            "STEP 5 MATCHED NOTES  →  STEP 6 TEMPO ESTIMATION",
        )

        note_y = 6
        c.setFillColor(INK)
        c.setFont("Consolas-Bold", 7)
        c.drawString(0, note_y + 18, "RELIABILITY GATE")
        c.setFont("Segoe", 7)
        c.setFillColor(MUTED)
        c.drawString(0, note_y + 6, "At least 3 exact pitch matches and 55% sequence agreement; otherwise return unrelated_piece.")


def tool_table():
    rows = [
        [P("Layer", "TableHeader"), P("Current choice", "TableHeader"), P("Why", "TableHeader")],
        [P("Client", "SmallStrong"), P("React, TypeScript, Vite", "Small"), P("Fast UI iteration and typed analysis contracts.", "Small")],
        [P("Media", "SmallStrong"), P("Web Audio API", "Small"), P("Local decode, video audio extraction and resampling.", "Small")],
        [P("Transcription", "SmallStrong"), P("Spotify Basic Pitch / TensorFlow.js", "Small"), P("Open-source audio-to-note baseline that runs in the browser.", "Small")],
        [P("API", "SmallStrong"), P("FastAPI and Pydantic", "Small"), P("Explicit schemas, automatic docs and deterministic analysis.", "Small")],
        [P("Reference", "SmallStrong"), P("MIDI and mido", "Small"), P("Stable pitch, timing, measure and beat ground truth.", "Small")],
        [P("Validation", "SmallStrong"), P("pytest plus controlled WAV fixtures", "Small"), P("Separates transcription defects from comparison defects.", "Small")],
    ]
    table = Table(rows, colWidths=[88, 148, CONTENT_W - 236], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("BACKGROUND", (0, 1), (-1, -1), WHITE),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return table


def profile_table():
    rows = [
        [P("Profile", "TableHeader"), P("Keeps", "TableHeader"), P("Suppresses", "TableHeader")],
        [P("Monophonic piano", "SmallStrong"), P("One strongest note per onset", "Small"), P("Overlaps, weak partials and short fragments", "Small")],
        [P("Polyphonic piano", "SmallStrong"), P("Simultaneous chord tones", "Small"), P("Weak resonances and duplicate sustained fragments", "Small")],
        [P("Guitar arpeggio", "SmallStrong"), P("Sequential attacks with ringing strings", "Small"), P("Harmonics, release transients and decay retriggers", "Small")],
    ]
    table = Table(rows, colWidths=[130, 176, CONTENT_W - 306], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("BACKGROUND", (0, 1), (-1, -1), WHITE),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return table


def decision_box(title: str, body: str, fill=WHITE):
    content = [P(title, "Section"), P(body, "BodyTech")]
    table = Table([[content]], colWidths=[CONTENT_W])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), fill),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return table


def build_story():
    story = []

    # Page 1
    story += [Spacer(1, 17 * mm), P("ENGINEERING OVERVIEW", "Kicker")]
    story.append(P("MusicAID performance<br/>analysis MVP", "TitleLarge"))
    story.append(P(
        "A working reference-based system that turns a short audio or video performance into measure-level pitch and timing feedback.",
        "Lead",
    ))
    story.append(Spacer(1, 4 * mm))
    story.append(MetricStrip([
        ("3", "reference pieces"),
        ("30", "controlled fixtures"),
        ("30", "backend tests"),
        ("< 60s", "MVP input limit"),
    ]))
    story.append(Spacer(1, 9 * mm))
    story.append(P("What was built", "Section"))
    story.append(bullet("Local audio-to-note transcription for audio and video uploads."))
    story.append(bullet("Reference MIDI parsing with pitch, measure, beat and duration metadata."))
    story.append(bullet("Tempo and transposition-aware sequence comparison."))
    story.append(bullet("Wrong, missed, extra, timing and tuning-related feedback."))
    story.append(bullet("A visual score, measure playback, guided error review and final recommendations."))
    story.append(Spacer(1, 7 * mm))
    quote = Table([[P(
        "Transcription and evaluation are intentionally separated. The ML model determines what was heard; the analysis service determines how that performance relates to the selected score.",
        "Quote",
    )]], colWidths=[CONTENT_W])
    quote.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), GREEN),
        ("LEFTPADDING", (0, 0), (-1, -1), 15),
        ("RIGHTPADDING", (0, 0), (-1, -1), 15),
        ("TOPPADDING", (0, 0), (-1, -1), 13),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 13),
    ]))
    story.append(quote)
    story.append(PageBreak())

    # Page 2
    story += section_title(
        "01 / File journey",
        "One recording, from upload to feedback",
        "The browser turns the recording into note events. FastAPI compares those events with the selected MIDI and returns an explainable report.",
    )
    story.append(FileJourneyDiagram())
    story.append(Spacer(1, 4 * mm))
    story.append(decision_box(
        "What actually crosses the API boundary",
        "In the current MVP, the original recording stays in the browser. The backend receives only cleaned note events: pitch, start time, duration and confidence.",
        MINT,
    ))
    story.append(PageBreak())

    # Page 3
    story += section_title(
        "02 / System architecture",
        "A hybrid client and backend pipeline",
        "The browser handles media and ML inference. FastAPI remains the source of truth for references, alignment, scoring and feedback.",
    )
    story.append(ArchitectureDiagram())
    story.append(Spacer(1, 5 * mm))
    story.append(P("Design rationale", "Section"))
    reasons = [
        [P("Local inference", "SmallStrong"), P("No large media upload, lower server cost, immediate feedback and better privacy.", "Small")],
        [P("Server evaluation", "SmallStrong"), P("One scoring implementation can serve web, mobile, teacher dashboards and future lesson rooms.", "Small")],
        [P("Small contract", "SmallStrong"), P("The API receives only pitch, onset, duration and confidence. The transcription model can be replaced independently.", "Small")],
    ]
    t = Table(reasons, colWidths=[102, CONTENT_W - 102])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), WHITE),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.append(t)
    story.append(PageBreak())

    # Page 4
    story += section_title(
        "03 / Backend algorithm",
        "Two-pass alignment before error classification",
        "The service first understands the musical sequence, then estimates tempo, normalizes time and performs a second comparison with timing context.",
    )
    story.append(AlgorithmDiagram())
    story.append(Spacer(1, 3 * mm))
    rules = [
        [P("Event", "TableHeader"), P("Interpretation", "TableHeader"), P("Penalty", "TableHeader")],
        [P("Wrong / missed", "Small"), P("A reference position has the wrong pitch or no onset.", "Small"), P("1.0", "Small")],
        [P("Timing / extra", "Small"), P("Correct pitch outside 160 ms, or an unmatched performed event.", "Small"), P("0.5", "Small")],
        [P("Tuning", "Small"), P("Repeated adjacent-semitone pattern on a recurring guitar pitch.", "Small"), P("0.25", "Small")],
    ]
    rt = Table(rules, colWidths=[95, CONTENT_W - 145, 50])
    rt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("BACKGROUND", (0, 1), (-1, -1), WHITE),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(rt)
    story.append(PageBreak())

    # Page 5
    story += section_title(
        "04 / Tools and quality controls",
        "Simple components with explicit responsibilities",
        "The stack was selected for a reproducible MVP, not for infrastructure volume.",
    )
    story.append(tool_table())
    story.append(Spacer(1, 7 * mm))
    story.append(P("Instrument-specific transcription profiles", "Section"))
    story.append(profile_table())
    story.append(Spacer(1, 7 * mm))
    story.append(MetricStrip([
        ("100%", "exact reference test"),
        ("9 -> 6", "guitar raw to real onsets"),
        ("+/-12", "semitone search range"),
        ("160ms", "timing tolerance"),
    ], height=52))
    story.append(Spacer(1, 6 * mm))
    story.append(P(
        "Controlled fixtures isolate two failure sources: transcription quality and comparison logic. Perfect, slower, transposed, partial, overplayed, wrong-note, late-note, mixed, very-poor and unrelated scenarios are generated for each reference.",
        "BodyTech",
    ))
    story.append(PageBreak())

    # Page 6
    story += section_title(
        "05 / Engineering decisions",
        "What stays, what changes and what is validated next",
        "The MVP is intentionally narrow: it demonstrates the full analysis loop while keeping production risks visible.",
    )
    story.append(decision_box(
        "Kept for production",
        "A small note-event API, server-side scoring rules, reference MIDI as ground truth, instrument-specific preprocessing and controlled regression fixtures.",
        MINT,
    ))
    story.append(Spacer(1, 4 * mm))
    story.append(decision_box(
        "Changes for production",
        "Add a reference registry and cache, a real evaluation dataset, local tempo warping for rubato, confidence calibration, observability, persisted attempts and optional server-side GPU transcription for weak devices or authoritative scoring.",
        VIOLET,
    ))
    story.append(Spacer(1, 4 * mm))
    story.append(decision_box(
        "Known boundaries",
        "Basic Pitch returns quantized MIDI notes rather than cents. Dense pedal, reverb and complex polyphony remain harder than a clean monophonic phrase. The current MIDI parser assumes constant tempo references. Live WebRTC lessons and OMR are outside this test scope.",
        AMBER,
    ))
    story.append(Spacer(1, 8 * mm))
    story.append(P("Production evolution", "Section"))
    evolution = [
        [P("Current", "SmallStrong"), P("Browser ML -> FastAPI alignment -> immediate feedback", "Small")],
        [P("Next", "SmallStrong"), P("Evaluation corpus -> threshold calibration -> per-instrument metrics", "Small")],
        [P("Scale", "SmallStrong"), P("Object storage -> job queue -> GPU workers -> persisted reports", "Small")],
        [P("Live", "SmallStrong"), P("WebRTC audio -> streaming note events -> lesson state machine -> TTS feedback", "Small")],
    ]
    et = Table(evolution, colWidths=[72, CONTENT_W - 72])
    et.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), WHITE),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.append(et)
    story.append(Spacer(1, 8 * mm))
    story.append(P(
        "The design does not hide model uncertainty. Transcription artifacts, musical mistakes, incomplete attempts and unsupported complexity remain distinguishable in both the code and the user feedback.",
        "Quote",
    ))
    return story


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = NumberedCanvasDoc(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=MARGIN_X,
        rightMargin=MARGIN_X,
        topMargin=MARGIN_TOP,
        bottomMargin=MARGIN_BOTTOM,
        title="MusicAID Technical Brief",
        author="Yevhen Chumak",
        subject="Architecture and performance analysis algorithm",
    )
    frame = Frame(
        MARGIN_X,
        MARGIN_BOTTOM,
        CONTENT_W,
        PAGE_H - MARGIN_TOP - MARGIN_BOTTOM,
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
    )
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=page_chrome)])
    doc.build(build_story())
    print(OUTPUT)


if __name__ == "__main__":
    main()
