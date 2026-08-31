/**
 * Detects the one attack a geofence cannot see.
 *
 * Every control on a clock-in punch asks "is this person at the salon?" — and in
 * the case that matters, the answer is yes. The first staff member to arrive logs
 * in as each colleague in turn, punches them all in on time, and the rest stroll
 * in at eleven. Distance, radius and accuracy all pass cleanly.
 *
 * What does not pass is the device. Sharing credentials still means one phone,
 * and one phone punching several people is visible in the log.
 */

export type PunchLike = {
  id: string;
  staffId: string;
  deviceId?: string | null;
  effectiveAt: Date;
};

export type SharedDeviceGroup = {
  deviceId: string;
  staffIds: string[];
  punchIds: string[];
};

/**
 * Devices that punched in more than one staff member on the same day.
 *
 * Deliberately reports rather than blocks: a legitimately shared family phone,
 * or a manager lending a handset to someone whose battery died, look identical
 * here and both deserve a person's judgement rather than a locked door.
 */
export function detectSharedDevice(punches: PunchLike[]): SharedDeviceGroup[] {
  const byDevice = new Map<string, PunchLike[]>();

  for (const punch of punches) {
    if (!punch.deviceId) continue;
    const list = byDevice.get(punch.deviceId);
    if (list) list.push(punch);
    else byDevice.set(punch.deviceId, [punch]);
  }

  const groups: SharedDeviceGroup[] = [];
  for (const [deviceId, list] of Array.from(byDevice.entries())) {
    const staffIds = Array.from(new Set(list.map(p => p.staffId)));
    if (staffIds.length < 2) continue;
    groups.push({ deviceId, staffIds, punchIds: list.map(p => p.id) });
  }
  return groups;
}

/**
 * The sharper version of the same signal: several staff punched from one device
 * within minutes of each other. A shared handset used honestly across a day looks
 * nothing like five people clocked in inside ninety seconds.
 */
export function detectRapidSuccession(punches: PunchLike[], windowMinutes = 5): SharedDeviceGroup[] {
  const windowMs = Math.max(0, windowMinutes) * 60_000;
  const groups: SharedDeviceGroup[] = [];

  const byDevice = new Map<string, PunchLike[]>();
  for (const punch of punches) {
    if (!punch.deviceId) continue;
    const list = byDevice.get(punch.deviceId);
    if (list) list.push(punch);
    else byDevice.set(punch.deviceId, [punch]);
  }

  for (const [deviceId, list] of Array.from(byDevice.entries())) {
    const sorted = [...list].sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime());

    // Sliding window over the device's punches, keeping the widest run that
    // covers two or more distinct staff members.
    let start = 0;
    let best: PunchLike[] = [];
    for (let end = 0; end < sorted.length; end++) {
      while (sorted[end].effectiveAt.getTime() - sorted[start].effectiveAt.getTime() > windowMs) {
        start++;
      }
      const window = sorted.slice(start, end + 1);
      const distinct = new Set(window.map(p => p.staffId));
      if (distinct.size >= 2 && window.length > best.length) best = window;
    }

    if (best.length > 0) {
      groups.push({
        deviceId,
        staffIds: Array.from(new Set(best.map(p => p.staffId))),
        punchIds: best.map(p => p.id),
      });
    }
  }

  return groups;
}
