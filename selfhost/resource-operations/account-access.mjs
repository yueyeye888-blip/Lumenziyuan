// The first configured administrator owns account management unless an explicit owner is configured.
export function canManageAccounts(config, user) {
  const admins = String(config.bindings?.RESOURCE_ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const owner = String(config.superAdminEmail || admins[0] || '')
    .trim()
    .toLowerCase();
  return Boolean(
    owner && admins.includes(owner) && user?.role !== 'customer' && user?.email?.toLowerCase() === owner,
  );
}
