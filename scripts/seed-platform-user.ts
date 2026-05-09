/**
 * Seeds a PlatformUser (Zikel internal staff) — invoked manually since platform
 * users have no self-registration endpoint by design.
 *
 * Usage:
 *   npm run seed:platform-user -- --email you@zikelsolutions.com --password 'secure!pass' \
 *     --first Julius --last Adebowale --role platform_admin
 *
 * Roles: platform_admin | support | engineer | billing
 */

// Load .env BEFORE any module that touches env vars (env.ts validates at import).
import 'dotenv/config';

import { provisionPlatformUser } from '../src/modules/admin/admin-auth.service.js';

type ParsedArgs = {
  email?: string;
  password?: string;
  first?: string;
  last?: string;
  role?: string;
};

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value && !value.startsWith('--')) {
        (out as Record<string, string>)[key] = value;
        i++;
      }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.email || !args.password || !args.first || !args.last || !args.role) {
    console.error(
      'Missing required args. Usage:\n' +
        "  npm run seed:platform-user -- --email you@zikelsolutions.com --password 'secret' \\\n" +
        '    --first Firstname --last Lastname --role platform_admin\n\n' +
        'Roles: platform_admin | support | engineer | billing',
    );
    process.exit(1);
  }

  if (!['platform_admin', 'support', 'engineer', 'billing'].includes(args.role)) {
    console.error(`Invalid --role "${args.role}". Use: platform_admin | support | engineer | billing`);
    process.exit(1);
  }

  const user = await provisionPlatformUser({
    email: args.email,
    password: args.password,
    role: args.role as 'platform_admin' | 'support' | 'engineer' | 'billing',
    firstName: args.first,
    lastName: args.last,
  });

  console.log('Platform user created:');
  console.log(`  id:    ${user.id}`);
  console.log(`  email: ${user.email}`);
  console.log(`  role:  ${user.role}`);
  console.log(`  name:  ${user.firstName} ${user.lastName}`);
}

main()
  .catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
