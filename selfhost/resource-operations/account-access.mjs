function adminEmails(config) {
  return String(config.bindings?.RESOURCE_ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

// The first configured administrator owns account management unless an explicit owner is configured.
export function canManageAccounts(config, user) {
  const admins = adminEmails(config);
  const owner = String(config.superAdminEmail || admins[0] || '')
    .trim()
    .toLowerCase();
  return Boolean(
    owner && admins.includes(owner) && user?.role !== 'customer' && user?.email?.toLowerCase() === owner,
  );
}

export function viewerFor(config, user) {
  const isAdmin = user.role !== 'customer' && adminEmails(config).includes(user.email.toLowerCase());
  const role = isAdmin ? 'admin' : user.role === 'customer' ? 'customer' : 'employee';
  return {
    userId: user.id,
    email: user.email,
    displayName: user.name || user.email,
    isAdmin,
    role,
    canManageAccounts: canManageAccounts(config, user),
  };
}
