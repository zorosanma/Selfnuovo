/**
 * CC scraper — sitemap-based catalog lookup + atob-decoded stream extraction.
 * CDN URLs expire quickly, so we use a lazy proxy for playback.
 */
import * as cheerio from 'cheerio';

const _b = (s: string) => Buffer.from(s, 'base64').toString();

// Obfuscated constants (all decoded at runtime)
const _HOST = _b('Y2luZW1hY2l0eS5jYw==');
const _BASE = _b('aHR0cHM6Ly9jaW5lbWFjaXR5LmNj');
const _SITEMAP_PATH = _b('L25ld3NfcGFnZXMueG1s');         // /news_pages.xml
const _KINDS = _b('bW92aWVzfHR2LXNlcmllcw==');            // movies|tv-series
const _PLAYER = _b('cGxheWVyLnBocA==');                   // player.php
const _TAG = 'CinCit';

const HEADERS: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
    'Cookie': `dle_user_id=${_b('MzI3Mjk=')}; dle_password=${_b('ODk0MTcxYzZhOGRhYjE4ZWU1OTRkNWM2NTIwMDlhMzU=')};`,
    'Referer': _BASE + '/'
};

export const CC_HEADERS = HEADERS;

const TMDB_API_KEY = _b('MTg2NWY0M2EwNTQ5Y2E1MGQzNDFkZDlhYjhiMjlmNDk=');

const atobPolyfill = (str: string): string => {
    try {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
        let output = '';
        str = String(str).replace(/[=]+$/, '');
        if (str.length % 4 === 1) return '';

        for (
            let bc = 0, bs = 0, buffer: any, i = 0;
            (buffer = str.charAt(i++));
            ~buffer && ((bs = bc % 4 ? bs * 64 + buffer : buffer), bc++ % 4)
                ? (output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6))))
                : 0
        ) {
            buffer = chars.indexOf(buffer);
        }
        return output;
    } catch {
        return '';
    }
};

async function fetchText(url: string): Promise<string> {
    const res = await fetch(url, { headers: HEADERS });
    return await res.text();
}

async function fetchJson(url: string): Promise<any> {
    const res = await fetch(url);
    return await res.json();
}

/**
 * Match a JSON array value for a given key in decoded text.
 * Uses bracket counting to handle nested arrays/objects.
 */
function matchJsonArray(text: string, key: string): RegExpMatchArray | null {
    const keyPattern = new RegExp(`${key}\\s*:\\s*\\[`);
    const keyMatch = keyPattern.exec(text);
    if (!keyMatch) return null;

    const startIdx = keyMatch.index! + keyMatch[0].length - 1;
    let depth = 0;
    let endIdx = startIdx;
    for (let i = startIdx; i < text.length; i++) {
        if (text[i] === '[') depth++;
        else if (text[i] === ']') depth--;
        if (depth === 0) {
            endIdx = i + 1;
            break;
        }
    }
    if (depth !== 0) return null;

    const arrayStr = text.substring(startIdx, endIdx);
    const result = [arrayStr, arrayStr] as unknown as RegExpMatchArray;
    result.index = keyMatch.index;
    result.input = text;
    return result;
}

function extractFileData(html: string): any {
    const $ = cheerio.load(html);
    let fileData: any = null;

    $('script').each((_i: number, el: any) => {
        if (fileData) return;

        const scriptHtml = $(el).html();
        if (!scriptHtml || !scriptHtml.includes('atob')) return;

        const regex = /atob\s*\(\s*(['"])(.*?)\1\s*\)/g;
        let match;

        while ((match = regex.exec(scriptHtml)) !== null) {
            const decoded = atobPolyfill(match[2]);

            const fileMatch =
                decoded.match(/file\s*:\s*(['"])(.*?)\1/s) ||
                matchJsonArray(decoded, 'file') ||
                matchJsonArray(decoded, 'sources');

            if (fileMatch) {
                let raw = fileMatch[2] || fileMatch[1];
                try {
                    if (raw.startsWith('[') || raw.startsWith('{')) {
                        raw = raw.replace(/\\(?![u"\\\/bfnrt])/g, '');
                        fileData = JSON.parse(raw);
                    } else {
                        fileData = raw;
                    }
                } catch {
                    fileData = raw;
                }
                console.log(`[${_TAG}] File data extracted, type:`, Array.isArray(fileData) ? `array[${fileData.length}]` : typeof fileData,
                    Array.isArray(fileData) && fileData[0]?.folder ? '(has folders)' : '');
            }
        }
    });

    return fileData;
}

function parseSubtitles(subtitleStr: string): SubtitleTrack[] {
    if (!subtitleStr || typeof subtitleStr !== 'string') return [];
    const tracks: SubtitleTrack[] = [];
    const parts = subtitleStr.split(/,(?=\[)/);
    for (const part of parts) {
        const match = part.match(/^\[([^\]]+)\](https?:\/\/.+)$/);
        if (match) {
            tracks.push({ label: match[1], url: match[2].replace(/\\\/\//g, '/') });
        }
    }
    return tracks;
}

function pickStream(fileData: any, type: string, season: number = 1, episode: number = 1): string | null {
    if (typeof fileData === 'string') {
        return fileData.startsWith('//') ? 'https:' + fileData : fileData;
    }

    if (!Array.isArray(fileData)) return null;

    if (type === 'movie' || fileData.every((x: any) => x && typeof x === 'object' && 'file' in x && !('folder' in x))) {
        const url = fileData[0]?.file || null;
        if (!url) return null;
        return url.startsWith('//') ? 'https:' + url : url;
    }

    let selectedSeasonFolder: any[] | null = null;
    for (const s of fileData) {
        if (!s || typeof s !== 'object' || !s.folder) continue;
        const title = (s.title || '').toLowerCase();
        const seasonRegex = new RegExp(`(?:season|stagione|s)\\s*0*${season}\\b`, 'i');
        if (seasonRegex.test(title)) {
            selectedSeasonFolder = s.folder;
            break;
        }
    }
    if (!selectedSeasonFolder) {
        for (const s of fileData) {
            if (s && s.folder) {
                selectedSeasonFolder = s.folder;
                break;
            }
        }
    }
    if (!selectedSeasonFolder) return null;

    let selectedEpisodeFile: string | null = null;
    for (const e of selectedSeasonFolder) {
        if (!e || typeof e !== 'object' || !e.file) continue;
        const title = (e.title || '').toLowerCase();
        const epRegex = new RegExp(`(?:episode|episodio|e)\\s*0*${episode}\\b`, 'i');
        if (epRegex.test(title)) {
            selectedEpisodeFile = e.file;
            break;
        }
    }
    if (!selectedEpisodeFile) {
        const idx = Math.max(0, episode - 1);
        const epData = idx < selectedSeasonFolder.length ? selectedSeasonFolder[idx] : selectedSeasonFolder[0];
        selectedEpisodeFile = epData?.file || null;
    }

    if (!selectedEpisodeFile) return null;
    return selectedEpisodeFile.startsWith('//') ? 'https:' + selectedEpisodeFile : selectedEpisodeFile;
}

function pickSubtitleStr(fileData: any, type: string, season: number = 1, episode: number = 1): string {
    if (!Array.isArray(fileData)) return '';

    if (type === 'movie' || fileData.every((x: any) => x && typeof x === 'object' && 'file' in x && !('folder' in x))) {
        return fileData[0]?.subtitle || '';
    }

    let selectedSeasonFolder: any[] | null = null;
    for (const s of fileData) {
        if (!s || typeof s !== 'object' || !s.folder) continue;
        const title = (s.title || '').toLowerCase();
        const seasonRegex = new RegExp(`(?:season|stagione|s)\\s*0*${season}\\b`, 'i');
        if (seasonRegex.test(title)) { selectedSeasonFolder = s.folder; break; }
    }
    if (!selectedSeasonFolder) {
        for (const s of fileData) { if (s && s.folder) { selectedSeasonFolder = s.folder; break; } }
    }
    if (!selectedSeasonFolder) return '';

    for (const e of selectedSeasonFolder) {
        if (!e || typeof e !== 'object') continue;
        const title = (e.title || '').toLowerCase();
        const epRegex = new RegExp(`(?:episode|episodio|e)\\s*0*${episode}\\b`, 'i');
        if (epRegex.test(title)) return e.subtitle || '';
    }
    const idx = Math.max(0, episode - 1);
    const epData = idx < selectedSeasonFolder.length ? selectedSeasonFolder[idx] : selectedSeasonFolder[0];
    return epData?.subtitle || '';
}

function resolveAbsUrl(base: string, rel: string): string {
    if (rel.startsWith('http://') || rel.startsWith('https://')) return rel;
    try {
        return new URL(rel, base).toString();
    } catch {
        return rel;
    }
}

function extractPlayerReferer(html: string, pageUrl: string): string {
    const re = new RegExp(`<iframe[^>]+src=["']([^"']*${_PLAYER.replace('.', '\\.')}[^"']*)["']`, 'i');
    const iframeMatch = html.match(re);
    if (!iframeMatch || !iframeMatch[1]) return pageUrl;
    return resolveAbsUrl(pageUrl, iframeMatch[1]);
}

function buildStreamHeaders(playerReferer: string, pageUrl: string): Record<string, string> {
    let origin: string;
    try {
        origin = new URL(pageUrl).origin;
    } catch {
        origin = _BASE;
    }
    return {
        'User-Agent': HEADERS['User-Agent'],
        'Referer': playerReferer,
        'Origin': origin,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.5',
        'Connection': 'keep-alive',
        'Cookie': HEADERS['Cookie']
    };
}

// ── Sitemap-based catalog lookup ──
interface SitemapEntry {
    url: string;
    kind: string;
    year: number | null;
    titleNorm: string;
    tokenCount: number;
}

let sitemapCache: { entries: SitemapEntry[]; expire: number } | null = null;
const SITEMAP_TTL_MS = 60 * 60 * 1000; // 1 hour

function normTitle(s: string): string {
    return s.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function parseSitemap(xml: string): SitemapEntry[] {
    const entries: SitemapEntry[] = [];
    const hostEsc = _HOST.replace(/\./g, '\\.');
    const re = new RegExp(`<loc>(https:\\/\\/${hostEsc}\\/(${_KINDS})\\/\\d+-([a-z0-9-]+)\\.html)<\\/loc>`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
        const [, url, kind, slug] = m;
        const yearMatch = slug.match(/-(\d{4})$/);
        const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
        const titleSlug = yearMatch ? slug.slice(0, -5) : slug;
        const titleNorm = normTitle(titleSlug.replace(/-/g, ' '));
        const tokenCount = titleNorm.split(' ').filter(Boolean).length;
        entries.push({ url, kind, year, titleNorm, tokenCount });
    }
    return entries;
}

async function getSitemapEntries(): Promise<SitemapEntry[]> {
    if (sitemapCache && sitemapCache.expire > Date.now()) {
        return sitemapCache.entries;
    }
    console.log(`[${_TAG}] Fetching catalog...`);
    const xml = await fetchText(`${_BASE}${_SITEMAP_PATH}`);
    const entries = parseSitemap(xml);
    console.log(`[${_TAG}] Catalog loaded: ${entries.length} entries`);
    sitemapCache = { entries, expire: Date.now() + SITEMAP_TTL_MS };
    return entries;
}

const STOPWORDS = new Set([
    'the', 'a', 'an', 'of', 'and', 'in', 'on', 'to', 'for', 'at', 'by', 'is', 'it',
    'il', 'lo', 'la', 'gli', 'le', 'un', 'uno', 'una', 'di', 'da', 'del', 'della', 'dei',
    'e', 'o', 'con', 'per', 'su', 'tra', 'fra'
]);

function significantTokens(tokens: string[]): Set<string> {
    return new Set(tokens.filter(t => t.length > 1 && !STOPWORDS.has(t)));
}

function scoreEntry(entry: SitemapEntry, qNorm: string, qTokens: string[], qSig: Set<string>, year: number | null): number {
    const tn = entry.titleNorm;
    let score: number;
    if (tn === qNorm) {
        score = 1000;
    } else if (tn.startsWith(qNorm) || qNorm.startsWith(tn)) {
        score = 500;
    } else {
        const tTokens = tn.split(' ').filter(Boolean);
        const tSig = significantTokens(tTokens);
        if (qSig.size === 0 || tSig.size === 0) {
            score = 0;
        } else {
            let hits = 0;
            for (const t of qSig) if (tSig.has(t)) hits++;
            const coverage = hits / qSig.size;
            const extraTokens = Math.max(0, tSig.size - qSig.size);
            score = coverage * 300 - extraTokens * 20 - Math.abs(entry.tokenCount - qTokens.length) * 2;
        }
    }
    if (year && entry.year) {
        if (entry.year === year) score += 50;
        else score -= Math.abs(entry.year - year) * 3;
    }
    return score;
}

async function lookupCatalog(query: string, year: number | null, mediaType: string): Promise<string | null> {
    try {
        const entries = await getSitemapEntries();
        const kind = mediaType === 'series' ? 'tv-series' : 'movies';
        const qNorm = normTitle(query);
        const qTokens = qNorm.split(' ').filter(Boolean);
        const qSig = significantTokens(qTokens);
        if (qTokens.length === 0) return null;

        let best: SitemapEntry | null = null;
        let bestScore = -Infinity;
        for (const e of entries) {
            if (e.kind !== kind) continue;
            const s = scoreEntry(e, qNorm, qTokens, qSig, year);
            if (s > bestScore) { bestScore = s; best = e; }
        }

        const minScore = 250;
        if (!best || bestScore < minScore) {
            console.log(`[${_TAG}] No confident match for "${query}" (best=${bestScore.toFixed(0)})`);
            return null;
        }
        console.log(`[${_TAG}] Match: "${query}" (${year}) → ${best.url} [score=${bestScore.toFixed(0)}]`);
        return best.url;
    } catch (err: any) {
        console.error(`[${_TAG}] Catalog lookup error:`, err?.message || err);
        return null;
    }
}

/**
 * Main entry: discover streams for a TMDB/IMDB ID.
 */
export async function getCCStreams(
    tmdbId: string,
    mediaType: string,
    season?: string,
    episode?: string,
    preferredLang?: string
): Promise<any[]> {
    try {
        const lang = preferredLang || 'en';
        console.log(`[${_TAG}] id=${tmdbId}, type=${mediaType}, S=${season}, E=${episode}, lang=${lang}`);

        const tmdbType = mediaType === 'series' ? 'tv' : 'movie';
        let imdbId: string | null = null;
        let title: string | null = null;
        let titleEn: string | null = null;
        let year: number | null = null;

        const extractYear = (r: any): number | null => {
            const d: string | undefined = r?.release_date || r?.first_air_date;
            if (!d) return null;
            const y = parseInt(d.slice(0, 4), 10);
            return Number.isFinite(y) ? y : null;
        };

        if (tmdbId.startsWith('tt')) {
            imdbId = tmdbId;
            try {
                const findData = await fetchJson(
                    `https://api.themoviedb.org/3/find/${tmdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`
                );
                const results = findData?.movie_results?.[0] || findData?.tv_results?.[0];
                titleEn = results?.title || results?.name || null;
                year = extractYear(results);
            } catch { /* proceed without */ }
            if (lang !== 'en') {
                try {
                    const findData = await fetchJson(
                        `https://api.themoviedb.org/3/find/${tmdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id&language=${lang}`
                    );
                    const results = findData?.movie_results?.[0] || findData?.tv_results?.[0];
                    title = results?.title || results?.name || null;
                    if (!year) year = extractYear(results);
                } catch { /* proceed without */ }
            }
            if (!title) title = titleEn;
        } else {
            const tmdbData = await fetchJson(
                `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`
            );
            imdbId = tmdbData?.imdb_id || tmdbData?.external_ids?.imdb_id || null;
            titleEn = tmdbData?.title || tmdbData?.name || null;
            year = extractYear(tmdbData);

            if (lang !== 'en') {
                try {
                    const langData = await fetchJson(
                        `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}&language=${lang}`
                    );
                    title = langData?.title || langData?.name || null;
                } catch { /* fallback */ }
            }
            if (!title) title = titleEn;
        }

        console.log(`[${_TAG}] IMDB: ${imdbId}, Title: ${title}, TitleEN: ${titleEn}, Year: ${year}`);

        if (!title && !titleEn) return [];

        let mediaUrl: string | null = null;
        if (title) {
            mediaUrl = await lookupCatalog(title, year, mediaType);
        }
        if (!mediaUrl && titleEn && titleEn !== title) {
            mediaUrl = await lookupCatalog(titleEn, year, mediaType);
        }

        if (!mediaUrl) {
            console.log(`[${_TAG}] No results found`);
            return [];
        }

        const pageHtml = await fetchText(mediaUrl);
        const fileData = extractFileData(pageHtml);

        if (!fileData) {
            console.log(`[${_TAG}] No playable content on page`);
            return [];
        }

        const tokenData: any = { page: mediaUrl };
        if (season) tokenData.s = parseInt(season, 10);
        if (episode) tokenData.e = parseInt(episode, 10);
        if (lang) tokenData.lang = lang;
        const pageToken = Buffer.from(JSON.stringify(tokenData)).toString('base64url');

        console.log(`[${_TAG}] Stream ready (lazy proxy)`);
        return [{
            name: _TAG,
            title: `🎬 ${title}`,
            url: `/proxy/cc/manifest.m3u8?token=${pageToken}`
        }];
    } catch (err: any) {
        console.error(`[${_TAG}] Error:`, err?.message || err);
        return [];
    }
}

export interface SubtitleTrack {
    label: string;
    url: string;
}

export interface FreshStream {
    url: string;
    headers: Record<string, string>;
    subtitles: SubtitleTrack[];
}

/**
 * Extract a fresh stream URL + proper CDN headers from a catalog page.
 * Called at playback time by the lazy proxy endpoint.
 */
export async function extractCCStream(pageUrl: string, season?: number, episode?: number): Promise<FreshStream | null> {
    try {
        const type = (season || episode) ? 'series' : 'movie';
        console.log(`[${_TAG}] Lazy resolve: ${pageUrl} (type=${type}, S=${season}, E=${episode})`);
        const pageHtml = await fetchText(pageUrl);
        const fileData = extractFileData(pageHtml);

        if (!fileData) {
            console.log(`[${_TAG}] Lazy resolve: no file data`);
            return null;
        }

        const url = pickStream(fileData, type, season || 1, episode || 1);
        if (!url) {
            console.log(`[${_TAG}] Lazy resolve: no stream URL`);
            return null;
        }

        const subtitleStr = pickSubtitleStr(fileData, type, season || 1, episode || 1);
        const subtitles = parseSubtitles(subtitleStr);
        console.log(`[${_TAG}] Subtitles found: ${subtitles.length}`);

        const playerReferer = extractPlayerReferer(pageHtml, pageUrl);
        const streamHeaders = buildStreamHeaders(playerReferer, pageUrl);
        console.log(`[${_TAG}] Fresh URL: ${url.substring(0, 100)}...`);

        return { url, headers: streamHeaders, subtitles };
    } catch (err: any) {
        console.error(`[${_TAG}] Lazy resolve error:`, err?.message || err);
        return null;
    }
}
