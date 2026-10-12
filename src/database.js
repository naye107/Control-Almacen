'use strict';
const { Pool } = require('pg');
function createPool(url) {
  const parsed = new URL(url);
  const local = ['localhost','127.0.0.1','::1'].includes(parsed.hostname);
  const ssl = local && parsed.searchParams.get('sslmode') !== 'require' ? false : { rejectUnauthorized: true };
  if (!local && parsed.searchParams.get('sslmode') === 'disable') throw new Error('SSL_REQUIRED_FOR_REMOTE_DATABASE');
  // Remove URL SSL overrides so certificate verification cannot be silently disabled by pg.
  for (const key of ['sslmode','sslcert','sslkey','sslrootcert']) parsed.searchParams.delete(key);
  const pool=new Pool({ connectionString: parsed.toString(), ssl, connectionTimeoutMillis: 5000, application_name:'japurima-phase5a', max:10 });
  pool.on('error',error=>console.error('PostgreSQL pool:',error.code||'CONNECTION_LOST'));
  return pool;
}
module.exports = { createPool };
