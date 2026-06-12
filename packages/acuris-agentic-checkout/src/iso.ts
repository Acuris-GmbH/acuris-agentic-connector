/**
 * ISO-3166-1 alpha-2 → alpha-3 mapping. Duplicated from the checkout
 * package's `iso.ts` rather than imported so the extension stays
 * standalone (deployable to a serverless function without bundling
 * React peer deps). The map is ~250 static entries — a few KB.
 */

const ISO2_TO_ISO3: Readonly<Record<string, string>> = Object.freeze({
  AF: "afg", AL: "alb", DZ: "dza", AS: "asm", AD: "and", AO: "ago", AI: "aia", AQ: "ata",
  AG: "atg", AR: "arg", AM: "arm", AW: "abw", AU: "aus", AT: "aut", AZ: "aze", BS: "bhs",
  BH: "bhr", BD: "bgd", BB: "brb", BY: "blr", BE: "bel", BZ: "blz", BJ: "ben", BM: "bmu",
  BT: "btn", BO: "bol", BQ: "bes", BA: "bih", BW: "bwa", BV: "bvt", BR: "bra", IO: "iot",
  BN: "brn", BG: "bgr", BF: "bfa", BI: "bdi", CV: "cpv", KH: "khm", CM: "cmr", CA: "can",
  KY: "cym", CF: "caf", TD: "tcd", CL: "chl", CN: "chn", CX: "cxr", CC: "cck", CO: "col",
  KM: "com", CD: "cod", CG: "cog", CK: "cok", CR: "cri", HR: "hrv", CU: "cub", CW: "cuw",
  CY: "cyp", CZ: "cze", CI: "civ", DK: "dnk", DJ: "dji", DM: "dma", DO: "dom", EC: "ecu",
  EG: "egy", SV: "slv", GQ: "gnq", ER: "eri", EE: "est", SZ: "swz", ET: "eth", FK: "flk",
  FO: "fro", FJ: "fji", FI: "fin", FR: "fra", GF: "guf", PF: "pyf", TF: "atf", GA: "gab",
  GM: "gmb", GE: "geo", DE: "deu", GH: "gha", GI: "gib", GR: "grc", GL: "grl", GD: "grd",
  GP: "glp", GU: "gum", GT: "gtm", GG: "ggy", GN: "gin", GW: "gnb", GY: "guy", HT: "hti",
  HM: "hmd", VA: "vat", HN: "hnd", HK: "hkg", HU: "hun", IS: "isl", IN: "ind", ID: "idn",
  IR: "irn", IQ: "irq", IE: "irl", IM: "imn", IL: "isr", IT: "ita", JM: "jam", JP: "jpn",
  JE: "jey", JO: "jor", KZ: "kaz", KE: "ken", KI: "kir", KP: "prk", KR: "kor", KW: "kwt",
  KG: "kgz", LA: "lao", LV: "lva", LB: "lbn", LS: "lso", LR: "lbr", LY: "lby", LI: "lie",
  LT: "ltu", LU: "lux", MO: "mac", MG: "mdg", MW: "mwi", MY: "mys", MV: "mdv", ML: "mli",
  MT: "mlt", MH: "mhl", MQ: "mtq", MR: "mrt", MU: "mus", YT: "myt", MX: "mex", FM: "fsm",
  MD: "mda", MC: "mco", MN: "mng", ME: "mne", MS: "msr", MA: "mar", MZ: "moz", MM: "mmr",
  NA: "nam", NR: "nru", NP: "npl", NL: "nld", NC: "ncl", NZ: "nzl", NI: "nic", NE: "ner",
  NG: "nga", NU: "niu", NF: "nfk", MK: "mkd", MP: "mnp", NO: "nor", OM: "omn", PK: "pak",
  PW: "plw", PS: "pse", PA: "pan", PG: "png", PY: "pry", PE: "per", PH: "phl", PN: "pcn",
  PL: "pol", PT: "prt", PR: "pri", QA: "qat", RO: "rou", RU: "rus", RW: "rwa", RE: "reu",
  BL: "blm", SH: "shn", KN: "kna", LC: "lca", MF: "maf", PM: "spm", VC: "vct", WS: "wsm",
  SM: "smr", ST: "stp", SA: "sau", SN: "sen", RS: "srb", SC: "syc", SL: "sle", SG: "sgp",
  SX: "sxm", SK: "svk", SI: "svn", SB: "slb", SO: "som", ZA: "zaf", GS: "sgs", SS: "ssd",
  ES: "esp", LK: "lka", SD: "sdn", SR: "sur", SJ: "sjm", SE: "swe", CH: "che", SY: "syr",
  TW: "twn", TJ: "tjk", TZ: "tza", TH: "tha", TL: "tls", TG: "tgo", TK: "tkl", TO: "ton",
  TT: "tto", TN: "tun", TR: "tur", TM: "tkm", TC: "tca", TV: "tuv", UG: "uga", UA: "ukr",
  AE: "are", GB: "gbr", US: "usa", UM: "umi", UY: "ury", UZ: "uzb", VU: "vut", VE: "ven",
  VN: "vnm", VG: "vgb", VI: "vir", WF: "wlf", EH: "esh", YE: "yem", ZM: "zmb", ZW: "zwe",
  AX: "ala",
});

const ISO3_TO_ISO2: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(ISO2_TO_ISO3).map(([k, v]) => [v, k])),
);

export function iso2ToIso3(code: string): string {
  if (!code) return "";
  return ISO2_TO_ISO3[code.toUpperCase()] ?? code.toLowerCase();
}

export function iso3ToIso2(code: string): string {
  if (!code) return "";
  return ISO3_TO_ISO2[code.toLowerCase()] ?? code.toUpperCase();
}
