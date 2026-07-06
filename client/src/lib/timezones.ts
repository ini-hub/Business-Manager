export interface TimezoneOption {
  value: string;
  label: string;
  region: string;
  offset: string;
}

export const TIMEZONES: TimezoneOption[] = [
  // Africa
  { value: "Africa/Lagos",        label: "Lagos, Abuja, Kano (WAT)",         region: "Africa",   offset: "+01:00" },
  { value: "Africa/Accra",        label: "Accra, Abidjan, Dakar (GMT)",       region: "Africa",   offset: "+00:00" },
  { value: "Africa/Nairobi",      label: "Nairobi, Dar es Salaam (EAT)",     region: "Africa",   offset: "+03:00" },
  { value: "Africa/Cairo",        label: "Cairo (EET)",                       region: "Africa",   offset: "+02:00" },
  { value: "Africa/Johannesburg", label: "Johannesburg, Harare (SAST)",      region: "Africa",   offset: "+02:00" },
  { value: "Africa/Casablanca",   label: "Casablanca, Rabat (WET)",          region: "Africa",   offset: "+01:00" },
  { value: "Africa/Addis_Ababa",  label: "Addis Ababa, Mogadishu (EAT)",     region: "Africa",   offset: "+03:00" },
  // Europe
  { value: "Europe/London",       label: "London, Dublin, Lisbon (GMT/BST)", region: "Europe",   offset: "+00:00" },
  { value: "Europe/Paris",        label: "Paris, Berlin, Rome (CET)",        region: "Europe",   offset: "+01:00" },
  { value: "Europe/Helsinki",     label: "Helsinki, Kyiv, Tallinn (EET)",    region: "Europe",   offset: "+02:00" },
  { value: "Europe/Moscow",       label: "Moscow, St. Petersburg (MSK)",     region: "Europe",   offset: "+03:00" },
  { value: "Europe/Istanbul",     label: "Istanbul, Ankara (TRT)",           region: "Europe",   offset: "+03:00" },
  // Americas
  { value: "America/New_York",     label: "New York, Toronto (ET)",          region: "Americas", offset: "-05:00" },
  { value: "America/Chicago",      label: "Chicago, Dallas, Winnipeg (CT)",  region: "Americas", offset: "-06:00" },
  { value: "America/Denver",       label: "Denver, Phoenix (MT)",            region: "Americas", offset: "-07:00" },
  { value: "America/Los_Angeles",  label: "Los Angeles, Vancouver (PT)",     region: "Americas", offset: "-08:00" },
  { value: "America/Anchorage",    label: "Anchorage, Juneau (AKT)",         region: "Americas", offset: "-09:00" },
  { value: "America/Sao_Paulo",    label: "São Paulo, Brasília (BRT)",       region: "Americas", offset: "-03:00" },
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires (ART)",   region: "Americas", offset: "-03:00" },
  { value: "America/Bogota",       label: "Bogotá, Lima, Quito (COT)",       region: "Americas", offset: "-05:00" },
  { value: "America/Mexico_City",  label: "Mexico City, Guadalajara (CST)",  region: "Americas", offset: "-06:00" },
  { value: "America/Halifax",      label: "Halifax, San Juan (AT)",          region: "Americas", offset: "-04:00" },
  // Asia
  { value: "Asia/Dubai",          label: "Dubai, Abu Dhabi, Muscat (GST)",  region: "Asia",     offset: "+04:00" },
  { value: "Asia/Kolkata",        label: "Mumbai, Delhi, Chennai (IST)",    region: "Asia",     offset: "+05:30" },
  { value: "Asia/Dhaka",          label: "Dhaka, Almaty (BST)",             region: "Asia",     offset: "+06:00" },
  { value: "Asia/Bangkok",        label: "Bangkok, Jakarta, Hanoi (ICT)",   region: "Asia",     offset: "+07:00" },
  { value: "Asia/Singapore",      label: "Singapore, Kuala Lumpur (SGT)",   region: "Asia",     offset: "+08:00" },
  { value: "Asia/Shanghai",       label: "Shanghai, Beijing, Taipei (CST)", region: "Asia",     offset: "+08:00" },
  { value: "Asia/Tokyo",          label: "Tokyo, Seoul, Osaka (JST)",       region: "Asia",     offset: "+09:00" },
  { value: "Asia/Riyadh",         label: "Riyadh, Baghdad, Kuwait (AST)",   region: "Asia",     offset: "+03:00" },
  { value: "Asia/Karachi",        label: "Karachi, Tashkent (PKT)",         region: "Asia",     offset: "+05:00" },
  // Pacific
  { value: "Pacific/Auckland",    label: "Auckland, Wellington (NZST)",     region: "Pacific",  offset: "+12:00" },
  { value: "Pacific/Sydney",      label: "Sydney, Melbourne, Brisbane (AET)",region: "Pacific", offset: "+10:00" },
  { value: "Pacific/Honolulu",    label: "Honolulu, Midway (HST)",          region: "Pacific",  offset: "-10:00" },
  // UTC
  { value: "UTC",                 label: "Coordinated Universal Time (UTC)", region: "UTC",     offset: "+00:00" },
];

export const TIMEZONE_REGIONS = TIMEZONES.map(t => t.region).filter((r, i, arr) => arr.indexOf(r) === i);

export function getTimezoneLabel(value: string): string {
  return TIMEZONES.find(t => t.value === value)?.label ?? value;
}

export function getTimezoneOffset(value: string): string {
  return TIMEZONES.find(t => t.value === value)?.offset ?? "";
}
