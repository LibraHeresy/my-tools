import { mkdir, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const document = await PDFDocument.create();
const font = await document.embedFont(StandardFonts.HelveticaBold);
const body = await document.embedFont(StandardFonts.Helvetica);
const colors = [
  rgb(0.85, 0.29, 0.18),
  rgb(0.18, 0.49, 0.35),
  rgb(0.24, 0.44, 0.66),
  rgb(0.65, 0.42, 0.12),
];

for (let index = 1; index <= 12; index += 1) {
  const page = document.addPage([595.28, 841.89]);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 595.28,
    height: 841.89,
    color: rgb(0.98, 0.96, 0.92),
  });
  page.drawRectangle({
    x: 0,
    y: 730,
    width: 595.28,
    height: 112,
    color: colors[(index - 1) % colors.length],
  });
  page.drawText("PDF Workbench", {
    x: 56,
    y: 778,
    size: 24,
    font,
    color: rgb(1, 0.97, 0.91),
  });
  page.drawText("Sample document for split testing", {
    x: 56,
    y: 752,
    size: 11,
    font: body,
    color: rgb(1, 0.97, 0.91),
  });
  page.drawText(String(index).padStart(2, "0"), {
    x: 56,
    y: 550,
    size: 180,
    font,
    color: rgb(0.9, 0.87, 0.82),
  });
  page.drawText(`Page ${index} of 12`, {
    x: 56,
    y: 470,
    size: 26,
    font,
    color: rgb(0.16, 0.14, 0.12),
  });
  page.drawText(
    "Use this file to try range, page-step and single-page splits.",
    {
      x: 56,
      y: 438,
      size: 12,
      font: body,
      color: rgb(0.42, 0.38, 0.33),
    },
  );
  page.drawText(
    "Every page in this PDF is a little different in color so the" +
      " thumbnail groups are easy to see.",
    {
      x: 56,
      y: 414,
      size: 12,
      font: body,
      color: rgb(0.42, 0.38, 0.33),
    },
  );
  page.drawLine({
    start: { x: 56, y: 88 },
    end: { x: 539, y: 88 },
    thickness: 1,
    color: rgb(0.86, 0.82, 0.75),
  });
  page.drawText("All processing stays on this computer.", {
    x: 56,
    y: 66,
    size: 9,
    font: body,
    color: rgb(0.55, 0.5, 0.44),
  });
}

const bytes = await document.save();
await mkdir("fixtures", { recursive: true });
await writeFile("fixtures/sample.pdf", bytes);
console.log(`Wrote fixtures/sample.pdf (${bytes.length} bytes)`);
