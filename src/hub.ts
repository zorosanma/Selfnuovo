/**
 * Hub source — proxies stream requests to an upstream Stremio addon (passthrough).
 * Accepts tmdb:/tt/kitsu: IDs and returns the upstream streams unchanged.
 */
import { request } from 'undici';

const _b = (s: string) => Buffer.from(s, 'base64').toString();

// Upstream addon base (obfuscated)
const _HUB_BASE = _b(
    'aHR0cHM6Ly9oZGh1Yi50aGV2b2xlY2l0b3IucXp6LmlvL2V5SjBiM0ppYjNnaU9pSjFibk5sZENJc0luRjFZV3hwZEdsbGN5STZJakl4TmpCd0xERXdPREJ3TERjeU1IQXNORGd3Y0NJc0luTnZjblFpT2lKa1pYTmpJaXdpWTI5dWRHVnVkQ0k2SW14aGRHbHVMR0Z6YVdGdUluMA=='
);

const HEADERS: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json'
};

/**
 * Build the upstream stream id.
 *  - movie: "tmdb:550" or "tt0133093"
 *  - series: "tt0944947:1:1" (preferred) or "tmdb:1399:1:1"
 */
function buildStreamId(tmdbId: string, type: string, season?: string, episode?: string): string {
    const isImdb = tmdbId.startsWith('tt');
    const base = isImdb ? tmdbId : `tmdb:${tmdbId}`;
    if (type === 'series' && season && episode) {
        return `${base}:${season}:${episode}`;
    }
    return base;
}

export async function getHubStreams(
    tmdbId: string,
    type: string,
    season?: string,
    episode?: string
): Promise<any[]> {
    try {
        const streamType = type === 'series' ? 'series' : 'movie';
        const streamId = buildStreamId(tmdbId, type, season, episode);
        const url = `${_HUB_BASE}/stream/${streamType}/${encodeURIComponent(streamId)}.json`;

        const { body, statusCode } = await request(url, { headers: HEADERS });
        if (statusCode !== 200) {
            console.error(`[Hub] upstream HTTP ${statusCode}`);
            return [];
        }

        const data = await body.json() as any;
        const streams = Array.isArray(data?.streams) ? data.streams : [];
        return streams;
    } catch (err: any) {
        console.error('[Hub] error:', err?.message || err);
        return [];
    }
}
