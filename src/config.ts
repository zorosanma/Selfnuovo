const _d = (s: string) => Buffer.from(s, 'base64').toString();
export const config = {
  tmdbApiKey: process.env.TMDB_API_KEY || _d('MTg2NWY0M2EwNTQ5Y2E1MGQzNDFkZDlhYjhiMjlmNDk='),
  d1: _d('dml4c3JjLnRv'),
  d2: _d('dml4Y2xvdWQuY28=')
};

export const AVAILABLE_LANGUAGES = [
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'es', label: 'Español (España)', flag: '🇪🇸' },
  { code: 'es-419', label: 'Español (Latinoamérica)', flag: '🇲🇽' },
  { code: 'fr', label: 'Français (France)', flag: '🇫🇷' },
  { code: 'fr-ca', label: 'Français (Canada)', flag: '🇨🇦' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'pt', label: 'Português (Portugal)', flag: '🇵🇹' },
  { code: 'pt-br', label: 'Português (Brasil)', flag: '🇧🇷' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'zh', label: '中文 (简体)', flag: '🇨🇳' },
  { code: 'zh-tw', label: '中文 (繁體)', flag: '🇹🇼' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
  { code: 'hi', label: 'हिन्दी', flag: '🇮🇳' },
  { code: 'tr', label: 'Türkçe', flag: '🇹🇷' },
  { code: 'pl', label: 'Polski', flag: '🇵🇱' },
  { code: 'nl', label: 'Nederlands', flag: '🇳🇱' },
  { code: 'ro', label: 'Română', flag: '🇷🇴' },
  { code: 'el', label: 'Ελληνικά', flag: '🇬🇷' },
  { code: 'he', label: 'עברית', flag: '🇮🇱' },
  { code: 'hu', label: 'Magyar', flag: '🇭🇺' },
  { code: 'cs', label: 'Čeština', flag: '🇨🇿' },
  { code: 'da', label: 'Dansk', flag: '🇩🇰' },
  { code: 'fi', label: 'Suomi', flag: '🇫🇮' },
  { code: 'sv', label: 'Svenska', flag: '🇸🇪' },
  { code: 'no', label: 'Norsk', flag: '🇳🇴' },
  { code: 'id', label: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'ms', label: 'Bahasa Melayu', flag: '🇲🇾' },
  { code: 'fil', label: 'Filipino', flag: '🇵🇭' },
  { code: 'th', label: 'ไทย', flag: '🇹🇭' },
  { code: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'ca', label: 'Català', flag: '🏴' },
  { code: 'eu', label: 'Euskara', flag: '🏴' },
  { code: 'gl', label: 'Galego', flag: '🏴' },
  { code: 'ta', label: 'தமிழ்', flag: '🇮🇳' },
  { code: 'te', label: 'తెలుగు', flag: '🇮🇳' },
  { code: 'kn', label: 'ಕನ್ನಡ', flag: '🇮🇳' },
  { code: 'ml', label: 'മലയാളം', flag: '🇮🇳' }
];

export interface UserConfig {
  vixEnabled: boolean;
  vixLang: string;
  ccEnabled: boolean;
  ccLang: string;
  hubEnabled: boolean;
  animeunityEnabled: boolean;
  nuvio4khdhub: boolean;
  nuvioUhdmovies: boolean;
  nuvioNetmirror: boolean;
  nuvioStreamflix: boolean;
  nuvioVideasy: boolean;
  nuvioVideasyLang: string;
  nuvioVidlink: boolean;
  nuvioYflix: boolean;
  nuvioCastle: boolean;
  nuvioMoviesdrive: boolean;
}

export const DEFAULT_CONFIG: UserConfig = {
  vixEnabled: true,
  vixLang: 'en',
  ccEnabled: false,
  ccLang: 'en',
  hubEnabled: false,
  animeunityEnabled: false,
  nuvio4khdhub: false,
  nuvioUhdmovies: false,
  nuvioNetmirror: false,
  nuvioStreamflix: false,
  nuvioVideasy: false,
  nuvioVideasyLang: 'it',
  nuvioVidlink: false,
  nuvioYflix: false,
  nuvioCastle: false,
  nuvioMoviesdrive: false,
};

export function encodeConfig(cfg: UserConfig): string {
  return Buffer.from(JSON.stringify(cfg)).toString('base64url');
}

export function decodeConfig(token: string): UserConfig {
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    // Accept both new and legacy config keys for backward compatibility
    return {
      vixEnabled: parsed.vixEnabled === true,
      vixLang: parsed.vixLang || DEFAULT_CONFIG.vixLang,
      ccEnabled: parsed.ccEnabled === true,
      ccLang: parsed.ccLang || DEFAULT_CONFIG.ccLang,
      hubEnabled: parsed.hubEnabled === true,
      animeunityEnabled: parsed.animeunityEnabled === true,
      nuvio4khdhub: parsed.nuvio4khdhub === true,
      nuvioUhdmovies: parsed.nuvioUhdmovies === true,
      nuvioNetmirror: parsed.nuvioNetmirror === true,
      nuvioStreamflix: parsed.nuvioStreamflix === true,
      nuvioVideasy: parsed.nuvioVideasy === true,
      nuvioVideasyLang: parsed.nuvioVideasyLang || DEFAULT_CONFIG.nuvioVideasyLang,
      nuvioVidlink: parsed.nuvioVidlink === true,
      nuvioYflix: parsed.nuvioYflix === true,
      nuvioCastle: parsed.nuvioCastle === true,
      nuvioMoviesdrive: parsed.nuvioMoviesdrive === true,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
