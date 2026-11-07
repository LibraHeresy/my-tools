export function sanitizeBaseName(name: string): string {
  let base = name.replace(/\.pdf$/i, "").normalize("NFC");
  base = base
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  if (!base) {
    base = "PDF";
  }

  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(base)) {
    base = `_${base}`;
  }

  if (base.length > 80) {
    base = base.slice(0, 80).trim();
  }

  return base;
}

export function addCollisionSuffix(fileName: string, attempt: number): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0) {
    return `${fileName} (${attempt})`;
  }
  return `${fileName.slice(0, dotIndex)} (${attempt})${fileName.slice(dotIndex)}`;
}
