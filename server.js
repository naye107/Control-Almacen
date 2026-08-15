const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const ROOT_DIR = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(ROOT_DIR, "data"));
const DATA_FILE = path.join(DATA_DIR, "inventory.json");
const DATABASE_URL = process.env.DATABASE_URL || "";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 8080);
const MAX_BODY_SIZE = 1024 * 1024;
const APP_USER = process.env.APP_USER || "admin";
const APP_PASSWORD = process.env.APP_PASSWORD || "admin123";
const SESSION_COOKIE = "japurima_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const sessions = new Map();
let pgPool = null;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function defaultState() {
  return { products: [], purchases: [], outputs: [] };
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    writeStateFile(defaultState());
  }
}

function normalizeProduct(product) {
  if (!product || typeof product !== "object") return product;

  return {
    ...product,
    unit: product.unit === "bidones" ? "galones" : product.unit
  };
}

function normalizeState(value) {
  return {
    products: Array.isArray(value?.products) ? value.products.map(normalizeProduct) : [],
    purchases: Array.isArray(value?.purchases) ? value.purchases : [],
    outputs: Array.isArray(value?.outputs) ? value.outputs : []
  };
}

function shouldUseDatabaseSsl() {
  if (!DATABASE_URL) return false;
  if (DATABASE_URL.includes("sslmode=disable")) return false;
  return !/localhost|127\.0\.0\.1/i.test(DATABASE_URL);
}

function getPgPool() {
  if (!DATABASE_URL) return null;
  if (pgPool) return pgPool;

  const { Pool } = require("pg");
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: shouldUseDatabaseSsl() ? { rejectUnauthorized: false } : false,
    enableChannelBinding: /channel_binding=require/i.test(DATABASE_URL),
    connectionTimeoutMillis: 10000
  });

  return pgPool;
}

async function ensurePostgresState() {
  const pool = getPgPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_state (
      id integer PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    INSERT INTO inventory_state (id, data)
    VALUES (1, $1::jsonb)
    ON CONFLICT (id) DO NOTHING
  `, [JSON.stringify(defaultState())]);
}

async function ensureStorage() {
  if (DATABASE_URL) {
    await ensurePostgresState();
    return;
  }

  if (IS_PRODUCTION) {
    throw new Error("DATABASE_URL es obligatorio en produccion para no perder datos al desplegar.");
  }

  ensureDataFile();
}

function readStateFile() {
  ensureDataFile();

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

function writeStateFile(nextState) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const normalized = normalizeState(nextState);
  const tempFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  fs.renameSync(tempFile, DATA_FILE);
}

async function readState() {
  if (DATABASE_URL) {
    const pool = getPgPool();
    const result = await pool.query("SELECT data FROM inventory_state WHERE id = 1");
    return normalizeState(result.rows[0]?.data || defaultState());
  }

  return readStateFile();
}

async function writeState(nextState) {
  const normalized = normalizeState(nextState);

  if (DATABASE_URL) {
    const pool = getPgPool();
    await pool.query(`
      INSERT INTO inventory_state (id, data, updated_at)
      VALUES (1, $1::jsonb, now())
      ON CONFLICT (id)
      DO UPDATE SET data = EXCLUDED.data, updated_at = now()
    `, [JSON.stringify(normalized)]);
    return;
  }

  writeStateFile(normalized);
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(request) {
  const header = request.headers.cookie || "";
  return header.split(";").reduce((cookies, item) => {
    const separatorIndex = item.indexOf("=");
    if (separatorIndex === -1) return cookies;

    const key = item.slice(0, separatorIndex).trim();
    const value = item.slice(separatorIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function isSecureRequest(request) {
  return request.headers["x-forwarded-proto"] === "https" || Boolean(request.socket.encrypted);
}

function sessionCookie(token, request) {
  const secure = isSecureRequest(request) ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`;
}

function clearSessionCookie(request) {
  const secure = isSecureRequest(request) ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    user,
    expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000
  });
  return token;
}

function getSession(request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  return { token, ...session };
}

function destroySession(request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) sessions.delete(token);
}

function isLoginValid(user, password) {
  return safeCompare(user, APP_USER) && safeCompare(password, APP_PASSWORD);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        reject(new Error("BODY_TOO_LARGE"));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });

    request.on("error", reject);
  });
}

async function handleApi(request, response) {
  if (request.method === "GET" && request.url === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      storage: DATABASE_URL ? "postgres" : "file"
    });
    return true;
  }

  if (request.method === "GET" && request.url === "/api/session") {
    const session = getSession(request);
    sendJson(response, 200, {
      authenticated: Boolean(session),
      user: session?.user || null
    });
    return true;
  }

  if (request.method === "POST" && request.url === "/api/login") {
    try {
      const payload = await readJsonBody(request);
      const user = String(payload.user || "");
      const password = String(payload.password || "");

      if (!isLoginValid(user, password)) {
        sendJson(response, 401, { ok: false, error: "INVALID_LOGIN" });
        return true;
      }

      const token = createSession(user);
      sendJson(response, 200, { ok: true, user }, {
        "Set-Cookie": sessionCookie(token, request)
      });
    } catch {
      sendJson(response, 400, { ok: false, error: "INVALID_JSON" });
    }
    return true;
  }

  if (request.method === "POST" && request.url === "/api/logout") {
    destroySession(request);
    sendJson(response, 200, { ok: true }, {
      "Set-Cookie": clearSessionCookie(request)
    });
    return true;
  }

  if (request.url.startsWith("/api/") && !getSession(request)) {
    sendJson(response, 401, { ok: false, error: "UNAUTHORIZED" });
    return true;
  }

  if (request.method === "GET" && request.url === "/api/state") {
    sendJson(response, 200, await readState());
    return true;
  }

  if (request.method === "POST" && request.url === "/api/state") {
    try {
      const payload = await readJsonBody(request);
      await writeState(payload);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      const statusCode = error.message === "BODY_TOO_LARGE" ? 413 : 400;
      sendJson(response, statusCode, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.url.startsWith("/api/")) {
    sendJson(response, 404, { ok: false, error: "NOT_FOUND" });
    return true;
  }

  return false;
}

function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const decodedPath = decodeURIComponent(requestedPath);
  const safePath = decodedPath.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT_DIR, safePath);
  const relativePath = path.relative(ROOT_DIR, filePath);
  const publicPath = relativePath.split(path.sep).join("/");
  const isPublicAsset = publicPath.startsWith("assets/");
  const isPublicFile = ["index.html", "app.js", "styles.css"].includes(publicPath) || isPublicAsset;

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || !isPublicFile) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Acceso denegado");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("No encontrado");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Cache-Control": [".html", ".css", ".js"].includes(extension) ? "no-store" : "public, max-age=300"
    });
    fs.createReadStream(filePath).pipe(response);
  });
}

function getNetworkUrls() {
  const urls = [`http://localhost:${PORT}`];
  const networks = os.networkInterfaces();

  Object.values(networks).forEach((items = []) => {
    items.forEach((item) => {
      if (item.family === "IPv4" && !item.internal) {
        urls.push(`http://${item.address}:${PORT}`);
      }
    });
  });

  return urls;
}

const server = http.createServer(async (request, response) => {
  const handled = await handleApi(request, response);
  if (!handled) serveStatic(request, response);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`El puerto ${PORT} ya esta en uso.`);
    console.error("Cierre otra ventana del servidor JAPURIMA o reinicie la computadora.");
    return;
  }

  console.error("No se pudo iniciar el servidor.");
  console.error(error.message);
});

function storageDescription() {
  return DATABASE_URL ? "PostgreSQL (DATABASE_URL)" : DATA_FILE;
}

ensureStorage().then(() => {
  server.listen(PORT, HOST, () => {
    console.log("Sistema JAPURIMA iniciado.");
    console.log("NO cierre esta ventana mientras use el sistema.");
    console.log("");
    console.log(`Datos: ${storageDescription()}`);
    console.log(`Login: usuario "${APP_USER}". Configure APP_USER y APP_PASSWORD para cambiarlo.`);
    console.log("");
    console.log("Abra una de estas direcciones en el navegador:");
    getNetworkUrls().forEach((url) => console.log(`  ${url}`));
  });
}).catch((error) => {
  console.error("No se pudo iniciar el almacenamiento de datos.");
  console.error(error.message);
  process.exit(1);
});
