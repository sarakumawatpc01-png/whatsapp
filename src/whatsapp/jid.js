function normalizeToJid(value) {
  if (value == null) return value;
  const raw = String(value).trim();
  if (!raw) return raw;

  if (raw === 'status@broadcast' || raw.endsWith('@g.us') || raw.endsWith('@broadcast')) return raw;
  if (raw.endsWith('@c.us')) return raw.replace('@c.us', '@s.whatsapp.net');
  if (raw.includes('@')) return raw;

  const digits = raw.replace(/\D/g, '');
  return digits ? `${digits}@s.whatsapp.net` : raw;
}

module.exports = { normalizeToJid };
