/** Separate SQL and browser fixtures inside this run's owned PostgreSQL
 * container. No existing database is reused, emptied or dropped here. */
export async function prepareBrowserDatabase({ databaseUrl, runId, environment }, { createPool } = {}) {
  let source, destination;
  try {
    const url = new URL(databaseUrl);
    if (environment !== 'local' || !/^hestia-app-[0-9a-f]{16}$/.test(runId ?? '')
      || url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1'
      || !/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535
      || url.username !== 'hestia_test' || !url.password || url.search || url.hash)
      throw new Error('Invalid browser database context');
    const sourceName = `hestia_test_${runId.slice('hestia-app-'.length)}`;
    if (url.pathname !== `/${sourceName}`) throw new Error('Unexpected source database');
    const databaseName = `${sourceName}_browser`;
    const makePool = createPool ?? (async options => {
      const { Pool } = await import('pg');
      return new Pool(options);
    });
    source = await makePool({ connectionString: url.href, ssl: false, max: 1, connectionTimeoutMillis: 5000 });
    const identity = await source.query('SELECT current_database() AS name');
    const marker = await source.query('SELECT run_id FROM hestia_bench_marker');
    if (identity.rows.length !== 1 || identity.rows[0].name !== sourceName
      || marker.rows.length !== 1 || marker.rows[0].run_id !== runId)
      throw new Error('Source ownership mismatch');
    // The identifier consists solely of a fixed prefix and validated hex.
    // CREATE without IF NOT EXISTS fails closed on a collision or partial retry.
    await source.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = `/${databaseName}`;
    destination = await makePool({ connectionString: url.href, ssl: false, max: 1, connectionTimeoutMillis: 5000 });
    const actual = await destination.query('SELECT current_database() AS name');
    if (actual.rows.length !== 1 || actual.rows[0].name !== databaseName)
      throw new Error('Destination ownership mismatch');
    const tables = await destination.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
    if (tables.rows.length !== 1 || tables.rows[0].count !== 0)
      throw new Error('Destination is not empty');
    await destination.query('CREATE TABLE hestia_bench_marker(run_id text PRIMARY KEY)');
    await destination.query('INSERT INTO hestia_bench_marker(run_id) VALUES($1)', [runId]);
    const destinationMarker = await destination.query('SELECT run_id FROM hestia_bench_marker');
    if (destinationMarker.rows.length !== 1 || destinationMarker.rows[0].run_id !== runId)
      throw new Error('Destination custody mismatch');
    return { databaseUrl: url.href, databaseName, custody: {
      sourceVerified: true, destinationVerified: true, initialPublicTableCount: tables.rows[0].count, markerVerified: true,
    } };
  } catch {
    // Driver/configuration errors can include connection details. Never expose
    // them to logs; the enclosing bench still removes its exact owned container.
    throw new Error('BROWSER_DATABASE_ISOLATION_FAILED');
  } finally {
    const closed = await Promise.allSettled([source?.end(), destination?.end()]);
    if (closed.some(result => result.status === 'rejected'))
      throw new Error('BROWSER_DATABASE_ISOLATION_FAILED');
  }
}
