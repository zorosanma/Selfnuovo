import * as cheerio from 'cheerio';
import { request } from 'undici';
import { config } from './config';
import { makeProxyToken, H1 } from './proxy';

const _b = (s: string) => Buffer.from(s, 'base64').toString();
// "/api/tv/", "/api/movie/", "application/json, text/plain, */*", "Accept"
const _P_TV = _b('L2FwaS90di8=');
const _P_MV = _b('L2FwaS9tb3ZpZS8=');
const _A_JSON = _b('YXBwbGljYXRpb24vanNvbiwgdGV4dC9wbGFpbiwgKi8q');
const _TAG = '[' + _b('UzE=') + ']';

async function resolveEmbed(tmdbId: string, season?: string, episode?: string): Promise<string | null> {
    const orig = `https://${config.d1}`;
    const apiPath = (season && episode) ? `${_P_TV}${tmdbId}/${season}/${episode}` : `${_P_MV}${tmdbId}`;
    const apiUrl = `${orig}${apiPath}`;
    console.log(`${_TAG} fetch ${apiUrl}`);
    try {
        const { body, statusCode } = await request(apiUrl, {
            headers: { ...H1, 'Accept': _A_JSON, 'Referer': `${orig}/` }
        });
        if (statusCode !== 200) { console.log(`${_TAG} status ${statusCode}`); return null; }
        const data: any = await body.json();
        const p = data?.src;
        if (!p) return null;
        return p.startsWith('http') ? p : `${orig}${p}`;
    } catch (err) {
        console.error(`${_TAG} err`, err);
        return null;
    }
}

export async function getS1Streams(tmdbId: string, season?: string, episode?: string, preferredLang?: string): Promise<{name: string, title: string, url: string}[]> {
    try {
        const orig = `https://${config.d1}`;
        const embedUrl = await resolveEmbed(tmdbId, season, episode);
        if (!embedUrl) { console.log(`${_TAG} no embed`); return []; }
        console.log(`${_TAG} embed: ${embedUrl}`);

        const { body, statusCode } = await request(embedUrl, {
            headers: { ...H1, 'Referer': `${orig}/` }
        });
        if (statusCode !== 200) { console.log(`${_TAG} embed status ${statusCode}`); return []; }

        const html = await body.text();
        const $ = cheerio.load(html);

        const scriptTag = $("script").filter((_, el) => {
            const content = $(el).html() || '';
            return content.includes('window.masterPlaylist') || (content.includes("'token':") && content.includes("'expires':"));
        }).first();

        const sc = scriptTag.html() || '';
        if (!sc) throw new Error("player script missing");

        let token = '', expires = '', asn = '', serverUrl = '';
        const tM = sc.match(/['"]token['"]\s*:\s*['"]([^'"]+)['"]/);
        const eM = sc.match(/['"]expires['"]\s*:\s*['"](\d+)['"]/);
        const aM = sc.match(/['"]asn['"]\s*:\s*['"]([^'"]*)['"]/);
        const uM = sc.match(/url\s*:\s*['"]([^'"]+)['"]/);
        if (tM) token = tM[1];
        if (eM) expires = eM[1];
        if (aM) asn = aM[1];
        if (uM) serverUrl = uM[1].replace(/\\/g, '');

        if (!token || !expires || !serverUrl) throw new Error("missing params");

        const canFHD = /window\.canPlayFHD\s*=\s*true/i.test(sc) || /canPlayFHD/.test(sc);
        const uo = new URL(serverUrl);
        const lang = preferredLang || 'en';
        uo.searchParams.set('token', token);
        uo.searchParams.set('expires', expires);
        uo.searchParams.set('lang', lang);
        if (asn) uo.searchParams.set('asn', asn);
        if (canFHD) uo.searchParams.set('h', '1');

        let finalUrl = uo.toString();
        const parts = uo.pathname.split('/');
        const pIdx = parts.indexOf('playlist');
        if (pIdx !== -1 && pIdx < parts.length - 1) {
            const n = parts[pIdx + 1];
            if (n && !n.includes('.')) {
                parts[pIdx + 1] = n + '.m3u8';
                uo.pathname = parts.join('/');
                finalUrl = uo.toString();
            }
        }

        console.log(`${_TAG} final: ${finalUrl}`);
        const proxyToken = makeProxyToken(finalUrl, H1);
        return [{
            name: "SC 🤌",
            title: "VIX 1080 🤌",
            url: `/proxy/hls/manifest.m3u8?token=${proxyToken}`
        }];
    } catch (err) {
        console.error(`${_TAG} extract err`, err);
        return [];
    }
}
