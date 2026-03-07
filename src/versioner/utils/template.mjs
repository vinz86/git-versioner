//Template minimale: sostituisce {{chiave}} con valori stringa.
export function renderTemplate(tpl, vars = {}) {
  const s = String(tpl ?? '');
  return s.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return (v === undefined || v === null) ? '' : String(v);
  });
}

export function pad2(n) { return String(n).padStart(2, '0'); }

// Formato: DD/MM/YYYY hh:mm
export function formatNowIt(d = new Date()) {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
