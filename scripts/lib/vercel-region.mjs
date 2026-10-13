import { isDeepStrictEqual } from 'node:util';

export const VERCEL_REGION = 'fra1';

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** This policy is for source deployments; it does not inspect prebuilt functions. */
export function assertFrankfurtConfig(config) {
  requireCondition(object(config), 'VERCEL_CONFIG_REQUIRED');
  requireCondition(isDeepStrictEqual(config.regions, [VERCEL_REGION]), 'VERCEL_FRANKFURT_REQUIRED');
  const regionSettings = [config];
  if (Object.hasOwn(config, 'functions')) {
    requireCondition(object(config.functions), 'VERCEL_FUNCTIONS_INVALID');
    regionSettings.push(...Object.values(config.functions));
  }
  for (const settings of regionSettings) {
    requireCondition(object(settings), 'VERCEL_FUNCTION_SETTINGS_INVALID');
    if (Object.hasOwn(settings, 'regions')) {
      requireCondition(isDeepStrictEqual(settings.regions, [VERCEL_REGION]), 'VERCEL_REGION_OVERRIDE_REFUSED');
    }
    if (Object.hasOwn(settings, 'functionFailoverRegions')) {
      requireCondition(isDeepStrictEqual(settings.functionFailoverRegions, []), 'VERCEL_FAILOVER_CHANGE_REFUSED');
    }
  }
}

/** Preserve the whole versioned configuration; only explicit operator choices vary. */
export function projectVercelConfig(sourceConfig, overrides = {}) {
  assertFrankfurtConfig(sourceConfig);
  requireCondition(object(overrides) && Object.keys(overrides).every(key => ['buildCommand', 'crons'].includes(key)), 'VERCEL_OPERATOR_OVERRIDE_REFUSED');
  if (Object.hasOwn(overrides, 'buildCommand')) {
    requireCondition(typeof overrides.buildCommand === 'string' && overrides.buildCommand.trim().length > 0 && overrides.buildCommand.length <= 256, 'VERCEL_BUILD_COMMAND_INVALID');
  }
  if (Object.hasOwn(overrides, 'crons')) {
    requireCondition(Array.isArray(overrides.crons) && overrides.crons.every(cron => object(cron) && typeof cron.path === 'string' && cron.path.startsWith('/') && typeof cron.schedule === 'string' && cron.schedule.trim().length > 0), 'VERCEL_CRONS_INVALID');
  }
  const projected = { ...sourceConfig, ...overrides };
  const copy = JSON.parse(JSON.stringify(projected));
  requireCondition(isDeepStrictEqual(copy, projected), 'VERCEL_JSON_CONFIG_REQUIRED');
  return copy;
}

/** Read back the exact --local-config file and pass the actual CLI argv before launch. */
export function assertVercelDeployment({ sourceConfig, deploymentConfig, overrides = {}, configPath, args }) {
  const expected = projectVercelConfig(sourceConfig, overrides);
  assertFrankfurtConfig(deploymentConfig);
  requireCondition(isDeepStrictEqual(deploymentConfig, expected), 'VERCEL_PROJECTION_DRIFT');
  requireCondition(Array.isArray(args) && args.every(arg => typeof arg === 'string'), 'VERCEL_ARGV_REQUIRED');
  requireCondition(typeof configPath === 'string' && configPath.length > 0, 'VERCEL_CONFIG_PATH_REQUIRED');
  requireCondition(args.filter(arg => arg === '--local-config').length === 1 && args[args.indexOf('--local-config') + 1] === configPath, 'VERCEL_CONFIG_PATH_MISMATCH');
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    // Vercel accepts grouped short flags such as -yA, which can replace the file.
    // Qualified operators use long options; reject aliases and option terminators.
    requireCondition(!/^-[^-]/.test(arg) && arg !== '--' && arg !== '-', 'VERCEL_LONG_OPTIONS_REQUIRED');
    requireCondition(!arg.startsWith('--local-config='), 'VERCEL_EXTRA_CONFIG_REFUSED');
    requireCondition(arg !== '--prebuilt' && !arg.startsWith('--prebuilt='), 'VERCEL_PREBUILT_NOT_QUALIFIED');
    if (arg === '--regions') {
      requireCondition(args[++index] === VERCEL_REGION, 'VERCEL_CLI_REGION_REFUSED');
    } else if (arg.startsWith('--regions=')) {
      requireCondition(arg.slice(arg.indexOf('=') + 1) === VERCEL_REGION, 'VERCEL_CLI_REGION_REFUSED');
    }
  }
}
