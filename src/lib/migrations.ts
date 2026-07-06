type RawDesign = Record<string, unknown>;
type Migration = (raw: RawDesign) => RawDesign;

export const CURRENT_SCHEMA_VERSION = 1;

const migrations: Record<number, Migration> = {};

function readVersion(raw: RawDesign): number {
  const version = raw.version;
  return typeof version === 'number' && Number.isInteger(version) && version >= 1
    ? version
    : 1;
}

export function migrateDesign(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  let next = raw as RawDesign;
  let version = readVersion(next);

  if (version > CURRENT_SCHEMA_VERSION) return raw;

  while (version < CURRENT_SCHEMA_VERSION) {
    const migrate = migrations[version];
    if (!migrate) return next;
    next = migrate(next);
    version += 1;
  }

  return next;
}
