if (!global._capturas)  global._capturas  = [];
if (!global._maxItems)  global._maxItems  = 500;
if (!global._sessionId) global._sessionId = generateSessionId();
if (!global._seq)       global._seq       = 0;

function generateSessionId() {
  return "sess_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return "desconocido"; }
}

function sanitizeString(val, max = 2048) {
  if (typeof val !== "string") return "";
  return val.slice(0, max).replace(/[<>"'`]/g, "");
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function extraerUUIDDeUrl(url) {
  if (!url) return null;
  const urlLow = url.toLowerCase().split("?")[0];
  if (!urlLow.endsWith(".ts")) return null;
  const m = url.match(UUID_RE);
  return m ? m[0].toLowerCase() : null;
}

function detectarMediaPorMime(mime = "") {
  const m = mime.toLowerCase();
  if (["video/mp4","video/webm","video/ogg","application/x-mpegurl","video/mp2t",
       "video/vnd.mpeg.dash.mpd","application/vnd.apple.mpegurl","application/dash+xml",
       "video/x-flv","video/x-matroska","video/mpeg","video/3gpp","video/quicktime",
       "application/mp4","application/octet-stream","binary/octet-stream",
  ].some(v => m.includes(v))) return "VIDEO";
  if (["image/jpeg","image/png","image/webp","image/gif","image/svg+xml","image/avif",
       "image/bmp","image/tiff","image/heic",
  ].some(v => m.includes(v))) return "IMAGEN";
  if (["audio/mpeg","audio/mp4","audio/aac","audio/ogg","audio/webm","audio/wav",
       "audio/flac","audio/opus",
  ].some(v => m.includes(v))) return "AUDIO";
  return null;
}

function detectarMediaPorExtension(url = "") {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const ext  = path.split(".").pop().split("?")[0];
    if (["m3u8","m3u"].includes(ext))                                       return "VIDEO_HLS";
    if (ext === "mpd")                                                      return "VIDEO_DASH";
    if (["ts","m4s","fmp4","cmfv","seg"].includes(ext))                     return "VIDEO_TS";
    if (["mp4","webm","mkv","flv","avi","mov","m4v","3gp","ogv",
         "mpeg","mpg","wmv","rm","divx","mts","m2ts"].includes(ext))        return "VIDEO_MP4";
    if (["mp3","aac","ogg","flac","wav","m4a","opus"].includes(ext))        return "AUDIO";
    if (["jpg","jpeg","png","webp","gif","svg","avif","ico",
         "bmp","tiff"].includes(ext))                                       return "IMAGEN";
  } catch {}
  return null;
}

async function detectarMediaPorContenido(url) {
  try {
    const resp = await fetch(url, {
      headers: { Range: "bytes=0-299" },
      signal:  AbortSignal.timeout(4000),
    });
    if (!resp.ok && resp.status !== 206) return null;

    const ct = (resp.headers.get("Content-Type") || "").toLowerCase();
    if (ct.includes("mpegurl") || ct.includes("x-mpegurl")) return "VIDEO_HLS";
    if (ct.includes("dash+xml") || ct.includes("mpd"))      return "VIDEO_DASH";
    if (ct.includes("mp2t"))                                 return "VIDEO_TS";
    if (ct.startsWith("video/"))                             return "VIDEO_MP4";
    if (ct.startsWith("audio/"))                             return "AUDIO";
    if (ct.startsWith("image/jpeg"))                         return "IMAGEN_JPEG";
    if (ct.startsWith("image/png"))                          return "IMAGEN_PNG";
    if (ct.startsWith("image/"))                             return "IMAGEN";

    const b = new Uint8Array(await resp.arrayBuffer());

    if (b[4]===0x66&&b[5]===0x74&&b[6]===0x79&&b[7]===0x70) return "VIDEO_MP4";
    if (b[0]===0x1A&&b[1]===0x45&&b[2]===0xDF&&b[3]===0xA3) return "VIDEO_MP4";
    if (b[0]===0x4F&&b[1]===0x67&&b[2]===0x67&&b[3]===0x53) return "VIDEO_MP4";
    if (b[0]===0x46&&b[1]===0x4C&&b[2]===0x56&&b[3]===0x01) return "VIDEO_MP4";
    if (b[0]===0x47&&(b.length<188||b[188]===0x47))          return "VIDEO_TS";

    const txt = new TextDecoder("utf-8", { fatal: false }).decode(b.slice(0, 50));
    const t   = txt.trimStart();
    if (t.startsWith("#EXTM3U"))                             return "VIDEO_HLS";
    if (t.includes("<MPD")||t.includes("urn:mpeg:dash"))     return "VIDEO_DASH";
    if (t.startsWith("<?xml")&&t.includes("MPD"))            return "VIDEO_DASH";

    if (b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF)               return "IMAGEN_JPEG";
    if (b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47) return "IMAGEN_PNG";
    if (b[0]===0x47&&b[1]===0x49&&b[2]===0x46&&b[3]===0x38) return "IMAGEN_GIF";
    if (b[0]===0x52&&b[1]===0x49&&b[2]===0x46&&b[3]===0x46&&
        b[8]===0x57&&b[9]===0x45&&b[10]===0x42&&b[11]===0x50) return "IMAGEN_WEBP";
    return null;
  } catch { return null; }
}

function tipoDesdeMedia(media_tipo, tipo_original) {
  if (!media_tipo) return tipo_original;
  if (media_tipo.startsWith("VIDEO") && tipo_original !== "VIDEO/STREAM" &&
      tipo_original !== "FRAGMENTO" && tipo_original !== "MANIFEST") {
    if (media_tipo === "VIDEO_HLS")  return "MANIFEST";
    if (media_tipo === "VIDEO_TS")   return "FRAGMENTO";
    if (media_tipo === "VIDEO_DASH") return "MANIFEST";
    return "VIDEO/STREAM";
  }
  if (media_tipo.startsWith("IMAGEN") && tipo_original !== "IMAGE") return "IMAGE";
  if (media_tipo === "AUDIO" && tipo_original !== "AUDIO")           return "AUDIO";
  return tipo_original;
}

function esInteresante(item) {
  if (item.status >= 400)                                    return true;
  if (item.metodo === "POST" && item.mime?.includes("json")) return true;
  if (item.size_bytes > 5 * 1024 * 1024)                    return true;
  if (item.duration_ms > 3000)                               return true;
  if (item.media_tipo)                                       return true;
  if (item.video_uuid)                                       return true;
  return false;
}

export default async function handler(req, res) {
  // ── CORS: completamente abierto para que el panel.html funcione desde cualquier origen ──
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
  res.setHeader("Access-Control-Max-Age",        "86400");
  res.setHeader("X-Content-Type-Options",        "nosniff");

  if (req.method === "OPTIONS") return res.status(200).end();

  // ── GET /api/ping ─────────────────────────────────────────────────────
  if (req.method === "GET" && req.query._ping === "1") {
    return res.status(200).json({ ok: true, ts: Date.now(), total: global._capturas.length });
  }

  // ── POST: recibir captura de la extensión ──────────────────────────────
  if (req.method === "POST") {
    const body = req.body;
    if (!body?.url) return res.status(400).json({ error: "Falta url" });

    let url;
    try { url = new URL(body.url).toString(); }
    catch { return res.status(400).json({ error: "URL inválida" }); }

    // Detectar tipo de media: MIME → extensión → contenido real
    const media_tipo =
      detectarMediaPorMime(body.mime) ||
      detectarMediaPorExtension(url)  ||
      (await detectarMediaPorContenido(url));

    const video_uuid = extraerUUIDDeUrl(url);

    const tipo_raw    = sanitizeString(body.tipo || "DESCONOCIDO", 64);
    const tipo_final  = tipoDesdeMedia(media_tipo, tipo_raw);

    const item = {
      id:          Date.now() + Math.random().toString(36).slice(2),
      url:         sanitizeString(url),
      tipo:        tipo_final,
      subtipo:     sanitizeString(body.subtipo   || "", 64),
      metodo:      sanitizeString(body.metodo    || "GET", 10),
      mime:        sanitizeString(body.mime      || "", 128),
      status:      Number(body.status)     || 0,
      tab_url:     sanitizeString(body.tab_url   || "", 2048),
      tab_title:   sanitizeString(body.tab_title || "", 256),
      origen:      sanitizeString(body.origen    || "", 256),
      ts:          Date.now(),
      duration_ms: Number(body.duration_ms) || null,
      size_bytes:  Number(body.size_bytes)  || null,
      dominio:     extractDomain(url),
      session_id:  global._sessionId,
      media_tipo,
      video_uuid,
      count:       1,
    };

    const duplicado = global._capturas.find(
      i => i.url === item.url && i.session_id === item.session_id
    );

    if (duplicado) {
      duplicado.count++;
      duplicado.ts          = item.ts;
      duplicado.duration_ms = item.duration_ms ?? duplicado.duration_ms;
      duplicado.size_bytes  = item.size_bytes  ?? duplicado.size_bytes;
      duplicado.importante  = esInteresante(duplicado);
      if (item.mime && !duplicado.mime) duplicado.mime = item.mime;
      if (item.status && !duplicado.status) duplicado.status = item.status;
      return res.status(200).json({
        ok: true, dedup: true,
        total: global._capturas.length,
        seq: duplicado.seq,
        last_seq: global._seq,
      });
    }

    global._seq   += 1;
    item.seq       = global._seq;
    item.importante = esInteresante(item);

    global._capturas.unshift(item);
    if (global._capturas.length > global._maxItems) {
      global._capturas = global._capturas.slice(0, global._maxItems);
    }

    return res.status(200).json({
      ok: true,
      total:    global._capturas.length,
      seq:      item.seq,
      last_seq: global._seq,
      video_uuid,
      tipo_detectado: tipo_final,
    });
  }

  // ── GET: el panel pide los datos ──────────────────────────────────────
  if (req.method === "GET") {
    const {
      desde, desde_seq, tipo, dominio, session_id,
      media, importante, q, video_uuid, xxazul,
      limit = 200, offset = 0,
      orden = "seq_desc",
    } = req.query;

    let items = global._capturas;

    if (tipo       && tipo !== "TODOS") items = items.filter(i => i.tipo       === tipo);
    if (dominio)                        items = items.filter(i => i.dominio    === dominio);
    if (session_id)                     items = items.filter(i => i.session_id === session_id);
    if (media)                          items = items.filter(i => i.media_tipo?.startsWith(media));
    if (importante === "true")          items = items.filter(i => i.importante);
    if (desde)                          items = items.filter(i => i.ts        > Number(desde));
    if (desde_seq !== undefined)        items = items.filter(i => i.seq       > Number(desde_seq));
    if (xxazul === "true")              items = items.filter(i => !!i.video_uuid);
    if (video_uuid)                     items = items.filter(i => i.video_uuid === video_uuid.toLowerCase());

    if (q) {
      const ql = q.toLowerCase();
      items = items.filter(i =>
        i.url.toLowerCase().includes(ql)        ||
        i.tab_title.toLowerCase().includes(ql)  ||
        (i.video_uuid || "").includes(ql)
      );
    }

    items = items.slice().sort((a, b) =>
      orden === "seq_asc" ? a.seq - b.seq : b.seq - a.seq
    );

    const total_filtrado = items.length;
    items = items.slice(Number(offset), Number(offset) + Number(limit));

    const xxazulResumen = {};
    global._capturas.forEach(i => {
      if (!i.video_uuid) return;
      xxazulResumen[i.video_uuid] = (xxazulResumen[i.video_uuid] || 0) + 1;
    });

    return res.status(200).json({
      ok: true,
      total: global._capturas.length,
      total_filtrado,
      session_id: global._sessionId,
      last_seq:   global._seq,
      xxazul_grupos: xxazulResumen,
      items,
    });
  }

  // ── DELETE: limpiar todo ───────────────────────────────────────────────
  if (req.method === "DELETE") {
    global._capturas = [];
    if (req.query.nueva_sesion === "true") global._sessionId = generateSessionId();
    if (req.query.reset_seq    === "true") global._seq = 0;
    return res.status(200).json({
      ok: true, total: 0,
      session_id: global._sessionId,
      last_seq:   global._seq,
    });
  }

  return res.status(405).json({ error: "Método no permitido" });
}
