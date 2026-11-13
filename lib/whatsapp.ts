/**
 * WhatsApp helpers.
 *
 * Phase 1 only builds click-to-chat links (https://wa.me/...), which any phone
 * can open. Sending messages automatically requires the official WhatsApp
 * Business API and is deliberately NOT implemented here - unofficial
 * automation gets numbers banned. See ROADMAP.md (Phase 6) for the adapter
 * boundary that will host the official integration.
 */
export function normaliseWhatsAppNumber(phone: string): string {
  return phone.replace(/[^\d]/g, '');
}

export function buildWhatsAppLink(phone: string, message: string): string {
  const number = normaliseWhatsAppNumber(phone);
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export function buildQuoteRequestMessage(businessName = 'Contractors Guild'): string {
  return `Hi ${businessName}, I would like a quote for electrical work. My details: `;
}
