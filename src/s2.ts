import * as cheerio from 'cheerio';
import { request } from 'undici';
import { makeProxyToken, H2 } from './proxy';

const _b = (s: string) => Buffer.from(s, 'base64').toString();

const M_BASE = _b('aHR0cHM6Ly9hbmltZW1hcHBpbmcuc3RyZW1pby5kcGRucy5vcmc=');
const P_BASE = _b('aHR0cHM6Ly93d3cuYW5pbWV1bml0eS5zbw==');
const K_BASE = _b('aHR0cHM6Ly9raXRzdS5pby9hcGkvZWRnZS9hbmltZS8=');
const _VC = _b('dml4Y2xvdWQ=');
const _AU_K = _b('YW5pbWV1bml0eQ==');
const _TAG = '[' + _b('UzI=') + ']';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

async function resolveFromMapping(kitsuId: string, episodeNum: string): Promise<string | null> {
    try {
        const ep = parseInt(episodeNum) || 1;
        const url = `${M_BASE}/kitsu/${kitsuId}?ep=${ep}`;
        console.log(`${_TAG} map ${url}`);
        const { body, statusCode } = await request(url, { headers: { 'Accept': 'application/json' } });
        if (statusCode !== 200) { console.log(`${_TAG} map status ${statusCode}`); return null; }
        const data: any = await body.json();
        const m = data?.mappings?.[_AU_K];
        if (m) {
            const paths = Array.isArray(m) ? m : [m];
            for (const item of paths) {
                const p = typeof item === 'string' ? item : (item?.path || item?.url || item?.href || null);
                if (p) { console.log(`${_TAG} map path: ${p}`); return p; }
            }
        }
        return null;
    } catch (err: any) {
        console.error(`${_TAG} map err:`, err?.message || err);
        return null;
    }
}

async function resolveEpisodeFromMapping(kitsuId: string, episodeNum: string): Promise<number> {
    try {
        const ep = parseInt(episodeNum) || 1;
        const { body, statusCode } = await request(`${M_BASE}/kitsu/${kitsuId}?ep=${ep}`, { headers: { 'Accept': 'application/json' } });
        if (statusCode !== 200) return ep;
        const data: any = await body.json();
        const fk = data?.kitsu?.episode;
        if (fk && typeof fk === 'number' && fk > 0) return fk;
        const fr = data?.requested?.episode;
        if (fr && typeof fr === 'number' && fr > 0) return fr;
        return ep;
    } catch {
        return parseInt(episodeNum) || 1;
    }
}

async function getKTitle(kitsuId: string): Promise<string | null> {
    try {
        const { body, statusCode } = await request(`${K_BASE}${kitsuId}`);
        if (statusCode !== 200) return null;
        const data: any = await body.json();
        const a = data?.data?.attributes;
        return a?.titles?.en || a?.titles?.en_jp || a?.canonicalTitle || null;
    } catch { return null; }
}

async function getSession(): Promise<{csrfToken: string, cookie: string}> {
    const { body, headers } = await request(P_BASE, { headers: { 'User-Agent': UA } });
    const html = await body.text();
    const $ = cheerio.load(html);
    const csrfToken = $('meta[name="csrf-token"]').attr('content') || '';
    let cookie = '';
    const sc = headers['set-cookie'];
    if (sc) {
        if (Array.isArray(sc)) cookie = sc.map((c: string) => c.split(';')[0]).join('; ');
        else cookie = String(sc).split(';')[0] || '';
    }
    return { csrfToken, cookie };
}

async function searchByTitle(title: string, session: {csrfToken: string, cookie: string}): Promise<any[]> {
    const { body } = await request(`${P_BASE}/livesearch`, {
        method: 'POST',
        headers: {
            'User-Agent': UA,
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/json;charset=utf-8',
            'X-CSRF-Token': session.csrfToken,
            'Referer': P_BASE + '/',
            'Cookie': session.cookie
        },
        body: JSON.stringify({ title })
    });
    const result: any = await body.json();
    return result?.records || [];
}

async function getEmbedUrl(animePath: string, episodeNum: number): Promise<string | null> {
    const animeUrl = animePath.startsWith('http') ? animePath : `${P_BASE}${animePath}`;
    console.log(`${_TAG} page: ${animeUrl}`);

    const { body } = await request(animeUrl, { headers: { 'User-Agent': UA } });
    const html = await body.text();
    const $ = cheerio.load(html);

    const vp = $('video-player').first();
    const episodesStr = vp.attr('episodes') || '[]';

    let parsed: any[] = [];
    try {
        const unescaped = episodesStr
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
        parsed = JSON.parse(unescaped);
    } catch {
        console.error(`${_TAG} parse fail`);
        return null;
    }

    const target = parsed.find((e: any) => parseFloat(String(e.number || '')) === episodeNum);
    if (!target) {
        console.log(`${_TAG} ep ${episodeNum} not found in ${parsed.length}`);
        if (parsed.length === 1) return parsed[0].embed_url || null;
        return null;
    }

    const epPageUrl = `${animeUrl}/${target.id}`;
    console.log(`${_TAG} ep page: ${epPageUrl}`);

    const { body: epBody } = await request(epPageUrl, { headers: { 'User-Agent': UA } });
    const epHtml = await epBody.text();
    const $ep = cheerio.load(epHtml);

    let embedUrl = $ep('video-player').first().attr('embed_url');
    if (!embedUrl) {
        embedUrl = $ep(`iframe[src*="${_VC}"]`).first().attr('src');
    }
    if (embedUrl && !embedUrl.startsWith('http')) embedUrl = P_BASE + embedUrl;

    return embedUrl || null;
}

async function extractManifest(embedUrl: string): Promise<string | null> {
    console.log(`${_TAG} extract: ${embedUrl}`);
    const inObj = new URL(embedUrl);
    const tIn = inObj.searchParams.get('token');
    const eIn = inObj.searchParams.get('expires');
    const aIn = inObj.searchParams.get('asn');

    const { body, statusCode } = await request(embedUrl, { headers: H2 });

    let html = "";
    if (statusCode === 200) {
        html = await body.text();
    } else if (statusCode === 403 && tIn && eIn) {
        console.log(`${_TAG} 403 fallback`);
    } else {
        console.log(`${_TAG} embed status ${statusCode}`);
        return null;
    }

    let token = tIn || "", expires = eIn || "", asn = aIn || "", playlistUrl = "";

    const mpM = html.match(/window\.masterPlaylist\s*=\s*\{.*?params\s*:\s*\{(?<params>.*?)\}\s*,\s*url\s*:\s*['"](?<url>[^'"]+)['"]/s);
    if (mpM?.groups) {
        const pb = mpM.groups.params;
        playlistUrl = mpM.groups.url.replace(/\\/g, '');
        const tM = pb.match(/['"]token['"]\s*:\s*['"]([^'"]+)['"]/);
        const eM = pb.match(/['"]expires['"]\s*:\s*['"]([^'"]+)['"]/);
        const aM = pb.match(/['"]asn['"]\s*:\s*['"]([^'"]+)['"]/);
        if (tM) token = tM[1];
        if (eM) expires = eM[1];
        if (aM) asn = aM[1];
    } else {
        const uM = html.match(/masterPlaylist[\s\S]*?url\s*:\s*['"]([^'"]+)['"]/) || html.match(/url\s*:\s*['"](https?:[^'"]+\/playlist\/[^'"]+)['"]/);
        const tM = html.match(/token['"]\s*:\s*['"]([^'"]+)['"]/);
        const eM = html.match(/expires['"]\s*:\s*['"](\d+)['"]/);
        const aM = html.match(/asn['"]\s*:\s*['"]([^'"]*)['"]/);
        if (uM) playlistUrl = uM[1].replace(/\\/g, '');
        if (tM && !token) token = tM[1];
        if (eM && !expires) expires = eM[1];
        if (aM && !asn) asn = aM[1];
    }

    if (!playlistUrl) {
        const vM = embedUrl.match(/\/embed\/(\d+)/);
        if (vM) playlistUrl = `${inObj.origin}/playlist/${vM[1]}`;
    }

    if (!token || !expires || !playlistUrl) {
        console.log(`${_TAG} fail t=${!!token} e=${!!expires} u=${!!playlistUrl}`);
        return null;
    }

    const fo = new URL(playlistUrl);
    fo.searchParams.set('token', token);
    fo.searchParams.set('expires', expires);
    if (asn) fo.searchParams.set('asn', asn);

    const canFHD = /canPlayFHD\s*=\s*true/i.test(html) || inObj.searchParams.get('canPlayFHD') === '1';
    if (canFHD) fo.searchParams.set('h', '1');

    console.log(`${_TAG} manifest: ${fo.toString()}`);
    return ensureM3u8(fo.toString());
}

function ensureM3u8(url: string): string {
    try {
        const u = new URL(url);
        if (u.pathname.includes('/playlist/')) {
            const parts = u.pathname.split('/');
            const leaf = parts[parts.length - 1];
            if (leaf && !leaf.includes('.') && !leaf.endsWith('.m3u8')) {
                u.pathname = u.pathname + '.m3u8';
                return u.toString();
            }
        }
        return url;
    } catch { return url; }
}

export async function getS2Streams(kitsuId: string, episodeNumber: string = "1"): Promise<{name: string, title: string, url: string}[]> {
    try {
        console.log(`${_TAG} resolve kitsu:${kitsuId} ep=${episodeNumber}`);

        const resolvedEp = await resolveEpisodeFromMapping(kitsuId, episodeNumber);
        const mappedPath = await resolveFromMapping(kitsuId, episodeNumber);

        let embedUrl: string | null = null;
        if (mappedPath) embedUrl = await getEmbedUrl(mappedPath, resolvedEp);

        if (!embedUrl) {
            const title = await getKTitle(kitsuId);
            if (!title) { console.log(`${_TAG} no title`); return []; }
            console.log(`${_TAG} search: "${title}"`);
            const session = await getSession();
            const results = await searchByTitle(title, session);
            if (results.length === 0) { console.log(`${_TAG} no results`); return []; }
            const anime = results[0];
            const animePath = `/anime/${anime.id}-${anime.slug}`;
            console.log(`${_TAG} hit: id=${anime.id} slug=${anime.slug}`);
            embedUrl = await getEmbedUrl(animePath, resolvedEp);
        }

        if (!embedUrl) { console.log(`${_TAG} no embed`); return []; }

        const manifestUrl = await extractManifest(embedUrl);
        if (!manifestUrl) { console.log(`${_TAG} no manifest`); return []; }

        console.log(`${_TAG} raw: ${manifestUrl}`);
        const proxyToken = makeProxyToken(manifestUrl, H2);

        return [{
            name: "AU 🤌",
            title: "VIX 1080 🤌",
            url: `/proxy/hls/manifest.m3u8?token=${proxyToken}`
        }];
    } catch (err: any) {
        console.error(`${_TAG} extract err:`, err?.message || err);
        return [];
    }
}
