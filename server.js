const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const ROOT_DIR = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(ROOT_DIR, "data"));
const DATA_FILE = path.join(DATA_DIR, "inventory.json");
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 8080);
const MAX_BODY_SIZE = 1024 * 1024;
const APP_USER = process.env.APP_USER || "";
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const AUTH_ENABLED = Boolean(APP_USER && APP_PASSWORD);

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

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    writeState({ products: [], purchases: [], outputs: [] });
  }
}

function normalizeState(value) {
  return {
    products: Array.isArray(value?.products) ? value.products : [],
    purchases: Array.isArray(value?.purchases) ? value.purchases : [],
    outputs: Array.isArray(value?.outputs) ? value.outputs : []
  };
}

function readState() {
  ensureDataFile();

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return { products: [], purchases: [], outputs: [] };
  }
}

function writeState(nextState) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const normalized = normalizeState(nextState);
  const tempFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  fs.renameSync(tempFile, DATA_FILE);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
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

function isAuthorized(request) {
  if (!AUTH_ENABLED) return true;

  const header = request.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");

  if (scheme !== "Basic" || !encoded) return false;

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex === -1) return false;

    const user = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);
    return safeCompare(user, APP_USER) && safeCompare(password, APP_PASSWORD);
  } catch {
    return false;
  }
}

function requestLogin(response) {
  response.writeHead(401, {
    "Content-Type": "text/plain; charset=utf-8",
    "WWW-Authenticate": 'Basic realm="JAPURIMA"',
    "Cache-Control": "no-store"
  });
  response.end("Ingrese usuario y clave para acceder al sistema.");
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
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (request.method === "GET" && request.url === "/api/state") {
    sendJson(response, 200, readState());
    return true;
  }

  if (request.method === "POST" && request.url === "/api/state") {
    try {
      const payload = await readJsonBody(request);
      writeState(payload);
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

ensureDataFile();

const server = http.createServer(async (request, response) => {
  if (request.url === "/api/health") {
    await handleApi(request, response);
    return;
  }

  if (!isAuthorized(request)) {
    requestLogin(response);
    return;
  }

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

server.listen(PORT, HOST, () => {
  console.log("Sistema JAPURIMA iniciado.");
  console.log("NO cierre esta ventana mientras use el sistema.");
  console.log("");
  console.log(`Datos: ${DATA_FILE}`);
  console.log(AUTH_ENABLED ? "Acceso protegido con usuario y clave." : "Acceso sin clave. Configure APP_USER y APP_PASSWORD al publicarlo.");
  console.log("");
  console.log("Abra una de estas direcciones en el navegador:");
  getNetworkUrls().forEach((url) => console.log(`  ${url}`));
});
