// functions/lib/email-validation.ts — block throwaway / disposable email providers on the free
// path. Farmers lean on these to spin unlimited "fresh" verified emails; requiring a real mailbox
// is cheap friction that meaningfully raises their cost. Curated subset of the most common
// disposable providers + their alias domains (extend as new ones surface). Not exhaustive by
// design — the weekly free-test budget cap is the hard wallet seatbelt; this is added friction.

const DISPOSABLE_DOMAINS = new Set<string>([
  // Mailinator + clones
  'mailinator.com', 'mailinator.net', 'mailinator2.com', 'reallymymail.com', 'sogetthis.com',
  // Guerrilla Mail cluster
  'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.biz',
  'guerrillamail.de', 'guerrillamailblock.com', 'grr.la', 'sharklasers.com', 'spam.me',
  'pokemail.net', 'spam4.me',
  // 10-minute / temp families
  '10minutemail.com', '10minutemail.net', '20minutemail.com', 'temp-mail.org', 'tempmail.com',
  'tempmailo.com', 'tempmail.net', 'tempr.email', 'tempinbox.com', 'tempmail.plus',
  'minuteinbox.com', 'mytemp.email', 'tmpmail.org', 'tmpeml.com', 'mohmal.com', 'mohmal.in',
  // Yopmail + Nada + Trashmail families
  'yopmail.com', 'yopmail.net', 'yopmail.fr', 'getnada.com', 'nada.email',
  'trashmail.com', 'trashmail.net', 'trashmail.de', 'trash-mail.com', 'wegwerfmail.de',
  // Maildrop / Dispostable / Fakeinbox / others
  'maildrop.cc', 'dispostable.com', 'fakeinbox.com', 'mailnesia.com', 'mintemail.com',
  'emailondeck.com', 'spamgourmet.com', 'mailcatch.com', 'discard.email', 'discardmail.com',
  'maileater.com', 'getairmail.com', 'inboxkitten.com', 'emailfake.com', 'mailpoof.com',
  'burnermail.io', '33mail.com', 'anonbox.net', 'jetable.org', 'mailnull.com', 'spambog.com',
  'throwawaymail.com', 'throwawaymailbox.com', 'fakemail.net', 'fakemailgenerator.com',
  'luxusmail.org', 'moakt.com', 'moakt.cc', 'mailto.plus', 'fexbox.org', 'rover.info',
  'cuvox.de', 'dayrep.com', 'einrot.com', 'fleckens.hu', 'gustr.com', 'jourrapide.com',
  'superrito.com', 'teleworm.us', 'armyspy.com', 'rhyta.com',
  '1secmail.com', '1secmail.net', '1secmail.org', 'kzccv.com', 'qiott.com', 'wuuvo.com',
  'vusra.com', 'mailbox.in.ua', 'inbox.lv', 'tafmail.com', 'byom.de',
]);

// Returns true if the email's domain is a known disposable/throwaway provider.
export function isDisposableEmailDomain(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain) return false;
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  // Also block subdomains of a listed domain (e.g. foo.mailinator.com).
  return [...DISPOSABLE_DOMAINS].some(d => domain.endsWith('.' + d));
}
