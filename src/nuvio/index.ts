/**
 * Nuvio providers loader.
 * Dynamically invokes Nuvio-compatible scrapers (getStreams signature).
 * Each provider is a CommonJS module exporting { getStreams(tmdbId, mediaType, season, episode) }.
 */

import { config } from '../config';
import { makeProxyToken } from '../proxy';

export interface NuvioStream {
    name: string;
    title?: string;
    url: string;
    quality?: string;
    size?: string;
    headers?: Record<string, string>;
    provider?: string;
    [key: string]: any;
}

type GetStreamsFn = (tmdbId: string, mediaType: string, season?: any, episode?: any, options?: any) => Promise<NuvioStream[]>;

interface ProviderSpec {
    key: string;           // config flag key
    label: string;         // pretty name
    file: string;          // provider filename (under ./providers)
    filter?: (s: NuvioStream) => boolean; // optional post-filter
}

// Videasy available audio languages (parsed from "VIDEASY Name (Language)..." name).
// code 'all' = keep everything (globe in UI); 'en' = English/Original fallback.
export const VIDEASY_LANGUAGES: Array<{ code: string; label: string; flag: string; match: RegExp | null; serverLang: string[] }> = [
    { code: 'all', label: 'All (world)',   flag: '🌍', match: null,                  serverLang: [] /* no filter */ },
    { code: 'it',  label: 'Italian',       flag: '🇮🇹', match: /\(Italian\)/i,       serverLang: ['Italian'] },
    { code: 'en',  label: 'English / Original', flag: '🇬🇧', match: /\(Original\)/i, serverLang: ['Original'] },
    { code: 'de',  label: 'German',        flag: '🇩🇪', match: /\(German\)/i,        serverLang: ['German'] },
    { code: 'fr',  label: 'French',        flag: '🇫🇷', match: /\(French\)/i,        serverLang: ['French'] },
    { code: 'es',  label: 'Spanish',       flag: '🇪🇸', match: /\(Spanish\)/i,       serverLang: ['Spanish'] },
    { code: 'es-419', label: 'Spanish (Latin)', flag: '🇲🇽', match: /\(Latin\)/i,    serverLang: ['Latin'] },
    { code: 'pt',  label: 'Portuguese',    flag: '🇵🇹', match: /\(Portuguese\)/i,    serverLang: ['Portuguese'] },
    { code: 'hi',  label: 'Hindi',         flag: '🇮🇳', match: /\(Hindi\)/i,         serverLang: ['Hindi'] },
];

function videasyFilterFor(code: string): ((s: NuvioStream) => boolean) | null {
    if (!code || code === 'all') return null;
    const entry = VIDEASY_LANGUAGES.find(l => l.code === code);
    if (!entry || !entry.match) return null;
    const rx = entry.match;
    return (s) => rx.test(s?.name || '');
}

// Register providers. Videasy filter is resolved dynamically per-request.
const PROVIDERS: ProviderSpec[] = [
    { key: 'nuvio4khdhub',   label: '4KHDHub',    file: '4khdhub' },
    { key: 'nuvioUhdmovies', label: 'UHDMovies',  file: 'uhdmovies' },
    { key: 'nuvioNetmirror', label: 'NetMirror',  file: 'netmirror' },
    { key: 'nuvioStreamflix',label: 'StreamFlix', file: 'streamflix' },
    { key: 'nuvioVideasy',   label: 'Videasy',    file: 'videasy' },
    { key: 'nuvioVidlink',   label: 'Vidlink',    file: 'vidlink' },
    { key: 'nuvioYflix',     label: 'YFlix',      file: 'yflix' },
    { key: 'nuvioCastle',    label: 'Castle',     file: 'castle' },
    { key: 'nuvioMoviesdrive', label: 'MoviesDrive', file: 'moviesdrive' },
];

const loaded: Record<string, GetStreamsFn | null> = {};

function load(file: string): GetStreamsFn | null {
    if (loaded[file] !== undefined) return loaded[file];
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(`./providers/${file}`);
        const fn = mod && mod.getStreams;
        loaded[file] = typeof fn === 'function' ? fn : null;
    } catch (e: any) {
        console.error(`[Nuvio] failed to load provider ${file}:`, e?.message || e);
        loaded[file] = null;
    }
    return loaded[file];
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        p.then(v => { clearTimeout(t); resolve(v); },
               e => { clearTimeout(t); reject(e); });
    });
}

/**
 * Pre-flight probe: GET the stream URL server-side with the same headers
 * the client would use. Returns true if we get a playable response fast.
 * This is used to drop Videasy streams whose upstream CDN / CF worker
 * is currently returning 5xx or is unreachable from the VPS.
 */
async function probeStream(url: string, headers: Record<string, string>, ms: number): Promise<boolean> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
        const r = await fetch(url, {
            method: 'GET',
            headers: { ...headers, 'Range': 'bytes=0-1' },
            signal: ctrl.signal,
            redirect: 'follow',
        });
        clearTimeout(t);
        if (!r.ok) return false;
        // Drain a tiny bit so the connection closes cleanly
        try { await r.body?.cancel(); } catch { /* ignore */ }
        return true;
    } catch {
        clearTimeout(t);
        return false;
    }
}

function videasyStreamHeaders(n: NuvioStream): Record<string, string> {
    const provided = (n.headers && typeof n.headers === 'object') ? n.headers as Record<string, string> : {};
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': '*/*',
        ...provided,
    };
}

// Known Cloudflare Worker hosts used by some Videasy servers as a
// reverse-proxy to the real CDN origin. When the worker breaks (500), we
// strip the prefix and try the naked origin directly. URL shape:
//   https://<worker-host>/<origin-host>/<rest...>
// becomes
//   https://<origin-host>/<rest...>
const VIDEASY_WORKER_HOSTS = [
    'workers.dev',
];

function stripWorkerPrefix(url: string): string | null {
    try {
        const u = new URL(url);
        if (!VIDEASY_WORKER_HOSTS.some(h => u.hostname.endsWith(h))) return null;
        // path: "/hfs322.serversicuro.cc/hls2/..." → first segment looks like a hostname
        const m = u.pathname.match(/^\/([a-z0-9.\-]+\.[a-z]{2,})(\/.*)?$/i);
        if (!m) return null;
        const originHost = m[1];
        const rest = m[2] || '/';
        return `https://${originHost}${rest}${u.search || ''}`;
    } catch {
        return null;
    }
}

/**
 * Run all enabled Nuvio providers in parallel.
 * `enabled` is the map of config flags (e.g. { nuvio4khdhub: true, ... }).
 * `videasyLang` selects the Videasy audio language filter (default: 'it').
 *   'all' keeps every language; any other code keeps only that language,
 *   and falls back to English/Original if the requested language returned nothing.
 */
export async function getNuvioStreams(
    tmdbId: string,
    type: string,
    season: string | undefined,
    episode: string | undefined,
    enabled: Record<string, boolean>,
    videasyLang: string = 'it'
): Promise<any[]> {
    // Nuvio providers use 'tv' for series
    const mediaType = type === 'series' ? 'tv' : 'movie';
    const id = await resolveProviderTmdbId(tmdbId, mediaType);
    if (!id) return [];

    const tasks = PROVIDERS
        .filter(p => enabled[p.key])
        .map(async (p) => {
            const fn = load(p.file);
            if (!fn) return [] as any[];
            try {
                const s = season ? parseInt(season, 10) : undefined;
                const e = episode ? parseInt(episode, 10) : undefined;

                let list: NuvioStream[] = [];
                let filtered: NuvioStream[];

                if (p.key === 'nuvioVideasy') {
                    // Build a server filter from the chosen language so Videasy
                    // doesn't fan out to all 18 servers (the slowest one holds
                    // up the whole Promise.all for 30s+). Each language maps
                    // to its serverConfig.language tag.
                    const langEntry = VIDEASY_LANGUAGES.find(l => l.code === videasyLang);
                    const langTags = langEntry?.serverLang ?? [];
                    const makeFilter = (tags: string[]) => tags.length === 0
                        ? undefined
                        : ((_name: string, cfg: any) => tags.includes(cfg?.language));

                    // Primary attempt with servers for the requested language.
                    // Each Videasy server has its own 5s per-server timeout
                    // (slowest working one is Yoru ~3.6s), so outer can be tight.
                    const primaryFilter = makeFilter(langTags);
                    const primaryTimeout = primaryFilter ? 6000 : 7000;
                    try {
                        const raw = await withTimeout(
                            fn(id, mediaType, s, e, { serverFilter: primaryFilter }),
                            primaryTimeout,
                            `Nuvio/Videasy(${videasyLang})`
                        );
                        list = Array.isArray(raw) ? raw : [];
                    } catch (err: any) {
                        console.error(`[Nuvio/Videasy(${videasyLang})] error:`, err?.message || err);
                        list = [];
                    }

                    const primaryNameFilter = videasyFilterFor(videasyLang);
                    filtered = primaryNameFilter ? list.filter(primaryNameFilter) : list;

                    // English fallback if requested language returned nothing
                    if (filtered.length === 0 && videasyLang !== 'en' && videasyLang !== 'all') {
                        const enTags = VIDEASY_LANGUAGES.find(l => l.code === 'en')?.serverLang ?? ['Original'];
                        const fbFilter = makeFilter(enTags);
                        try {
                            const raw = await withTimeout(
                                fn(id, mediaType, s, e, { serverFilter: fbFilter }),
                                6000,
                                `Nuvio/Videasy(en-fallback)`
                            );
                            const fbList = Array.isArray(raw) ? raw : [];
                            const fbNameFilter = videasyFilterFor('en');
                            const fbFiltered = fbNameFilter ? fbList.filter(fbNameFilter) : fbList;
                            if (fbFiltered.length > 0) {
                                console.log(`[Nuvio/Videasy] ${videasyLang} empty → English/Original fallback (${fbFiltered.length})`);
                                filtered = fbFiltered;
                            }
                        } catch (err: any) {
                            console.error(`[Nuvio/Videasy(en-fallback)] error:`, err?.message || err);
                        }
                    }
                } else {
                    const raw = await withTimeout(fn(id, mediaType, s, e), 30000, `Nuvio/${p.label}`);
                    list = Array.isArray(raw) ? raw : [];
                    filtered = p.filter ? list.filter(p.filter) : list;
                }

                // For Videasy: drop streams whose upstream is dead (e.g. the
                // `wave.*.workers.dev` CF worker returns HTTP 500, or the
                // serversicuro.cc origin is geo-blocked from the VPS).
                // We probe each candidate URL with a 2.5s Range=0-1 GET and
                // keep only the ones that respond OK. If the URL goes through
                // a known CF worker proxy and fails, we also probe the
                // worker-stripped direct origin URL as a fallback.
                if (p.key === 'nuvioVideasy' && filtered.length > 0) {
                    const probed = await Promise.all(filtered.map(async (stream) => {
                        const hdrs = videasyStreamHeaders(stream);
                        if (await probeStream(stream.url, hdrs, 2500)) return stream;
                        const direct = stripWorkerPrefix(stream.url);
                        if (direct && direct !== stream.url) {
                            if (await probeStream(direct, hdrs, 2500)) {
                                console.log(`[Nuvio/Videasy] worker dead → using direct origin: ${direct.slice(0, 100)}`);
                                return { ...stream, url: direct };
                            }
                        }
                        console.warn(`[Nuvio/Videasy] dead upstream, dropping: ${stream.name || ''} ${stream.url?.slice(0, 80)}`);
                        return null;
                    }));
                    filtered = probed.filter((s): s is NuvioStream => s !== null);
                }

                const providerLabel = p.key === 'nuvioVideasy'
                    ? videasyLabelFor(videasyLang)
                    : p.label;
                return filtered.map((stream: NuvioStream) => toStremioStream(stream, providerLabel)).filter(Boolean);
            } catch (err: any) {
                console.error(`[Nuvio/${p.label}] error:`, err?.message || err);
                return [];
            }
        });

    const results = await Promise.all(tasks);
    const merged: any[] = [];
    for (const r of results) merged.push(...r);
    return merged;
}

function videasyLabelFor(code: string): string {
    const entry = VIDEASY_LANGUAGES.find(l => l.code === code);
    if (!entry) return 'Videasy';
    return `Videasy ${entry.flag}`;
}

async function resolveProviderTmdbId(inputId: string, mediaType: 'movie' | 'tv'): Promise<string | null> {
    if (!inputId) return null;

    const normalized = inputId.replace(/^tmdb:/, '');
    if (!normalized.startsWith('tt')) return normalized;

    const apiKey = config.tmdbApiKey;
    if (!apiKey || apiKey === 'YOUR_TMDB_API_KEY_HERE') {
        console.warn('[Nuvio] TMDB_API_KEY missing: cannot resolve IMDb id for providers');
        return null;
    }

    try {
        const resp = await fetch(`https://api.themoviedb.org/3/find/${normalized}?api_key=${apiKey}&external_source=imdb_id`);
        if (!resp.ok) {
            console.warn(`[Nuvio] TMDB find failed for ${normalized}: ${resp.status}`);
            return null;
        }

        const data = await resp.json() as any;
        const result = mediaType === 'tv' ? data?.tv_results?.[0] : data?.movie_results?.[0];
        const id = result?.id;
        if (!id) {
            console.warn(`[Nuvio] no TMDB match for IMDb id ${normalized}`);
            return null;
        }

        return String(id);
    } catch (err: any) {
        console.warn(`[Nuvio] IMDb->TMDB resolve error for ${normalized}:`, err?.message || err);
        return null;
    }
}

/**
 * Convert a Nuvio stream object to a Stremio stream object.
 * Routes the URL through our internal proxy so that required headers
 * (Referer/Origin/UA) are injected server-side — many Stremio clients
 * ignore behaviorHints.proxyHeaders, so we must give them a URL that
 * already works standalone.
 */
function toStremioStream(n: NuvioStream, providerLabel: string): any {
    if (!n || !n.url) return null;

    const quality = n.quality ? String(n.quality) : '';
    const baseName = (n.name || '').trim();
    const name = `Nuvio · ${providerLabel}${quality ? ` · ${quality}` : ''}`;
    const title = baseName || providerLabel;

    const providedHeaders = (n.headers && typeof n.headers === 'object') ? n.headers as Record<string, string> : {};

    // Build headers to send upstream:
    // - always include a desktop UA
    // - respect Referer/Origin if provider gave them
    // - else derive Referer from the URL origin (many CDNs enforce this)
    let urlOrigin = '';
    try { urlOrigin = new URL(n.url).origin; } catch { /* ignore */ }

    const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': '*/*',
        ...(urlOrigin ? { 'Referer': urlOrigin + '/', 'Origin': urlOrigin } : {}),
        ...providedHeaders,
    };

    // Detect HLS vs progressive by URL hints.
    // Known file hosts → progressive. Explicit .m3u8 → HLS. Vidlink CDN → HLS.
    // Others default to HLS proxy (which auto-falls-back to file streaming if
    // the upstream content isn't an M3U8 playlist).
    const urlPath = (n.url.split('?')[0] || '').toLowerCase();
    const host = urlOrigin.toLowerCase();
    const isProgressive =
        /\.(mkv|mp4|webm|avi|mov|ts|m4v|flv)$/i.test(urlPath) ||
        /hub\.toxix|pixeldrain|wasabisys|streamflixserver|google(usercontent|videos)|googleapis|r2\.cloudflarestorage|dropbox|mega\.nz/i.test(host) ||
        /\/download/i.test(urlPath);
    const isHls = !isProgressive;

    const token = makeProxyToken(n.url, headers, 6 * 3600 * 1000);
    const finalUrl = isHls
        ? `/proxy/hls/manifest.m3u8?token=${token}`
        : `/proxy/file?token=${token}`;

    const out: any = {
        name,
        title,
        url: finalUrl,
        behaviorHints: {
            notWebReady: true,
            proxyHeaders: { request: headers },
        },
    };

    return out;
}

// Re-export provider keys so config layer can reference them
export const NUVIO_PROVIDER_KEYS = PROVIDERS.map(p => p.key);
export const NUVIO_PROVIDERS_META = PROVIDERS.map(p => ({ key: p.key, label: p.label }));
