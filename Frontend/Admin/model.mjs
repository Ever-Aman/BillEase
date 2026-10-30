export const views = ['access', 'businesses', 'accounts', 'devices', 'activity', 'security'];
export const titles = {access:'Access', businesses:'Businesses', accounts:'Accounts', devices:'Devices', activity:'Activity', security:'Security'};
export function matches(query, ...values) {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || values.some(value => String(value ?? '').toLocaleLowerCase().includes(needle));
}
export function roleIssue(memberships, userId, businessId, role) {
  const active = memberships.filter(m => m.user_id === userId && m.active !== false);
  if (active.some(m => m.business_id === businessId)) return 'This account already has active access to this business. Remove that access before changing its role.';
  if (role === 'staff' && active.length) return 'Staff accounts can belong to exactly one business. This account already has access.';
  if (role === 'owner' && active.some(m => m.role === 'staff')) return 'A staff account cannot also be an owner. Remove its staff access first.';
  return '';
}
export function dateLabel(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {dateStyle:'medium', timeStyle:'short'}).format(date);
}

export function businessCreation(id, name, documentMode) {
  if (!['composition','regular_gst'].includes(documentMode)) throw new Error('Choose composition or regular GST');
  if (!name.trim()) throw new Error('Enter business name');
  return {id,name:name.trim(),documentMode};
}
