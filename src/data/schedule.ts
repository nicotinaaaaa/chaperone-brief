export interface WeeklyCadence {
	type: 'weekly';
	/** 0 = Sunday, matching Intl's "short" weekday ordering below */
	dayOfWeek: number;
	hour: number;
	minute?: number;
	/** IANA timezone name — wall-clock time above is local to this zone */
	timeZone: string;
}

export type Cadence = WeeklyCadence;

export interface ScheduleTask {
	name: string;
	slug: string;
	cadence: Cadence;
	cadenceLabel: string;
	description: string;
	publishesTo: string;
	active: boolean;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Wall-clock time in an IANA zone isn't a fixed UTC offset (DST), so this
// isn't just "subtract N hours" — it asks the platform's own timezone
// database what a given UTC instant reads as in `timeZone`, and solves for
// the instant whose reading matches the target wall clock.
function tzOffsetMinutes(utcMillis: number, timeZone: string): number {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', {
			timeZone,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
		})
			.formatToParts(utcMillis)
			.map((p) => [p.type, p.value]),
	);
	const asIfUTC = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		Number(parts.hour),
		Number(parts.minute),
		Number(parts.second),
	);
	return (asIfUTC - utcMillis) / 60000;
}

function zonedWallClockToUtc(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	timeZone: string,
): Date {
	const desiredAsIfUTC = Date.UTC(year, month - 1, day, hour, minute, 0);
	const offset = tzOffsetMinutes(desiredAsIfUTC, timeZone);
	let utcMillis = desiredAsIfUTC - offset * 60000;
	// Refine once more in case the offset itself differs at the corrected
	// instant (only matters within a couple of hours of a DST transition).
	const offset2 = tzOffsetMinutes(utcMillis, timeZone);
	if (offset2 !== offset) utcMillis = desiredAsIfUTC - offset2 * 60000;
	return new Date(utcMillis);
}

function localDateParts(instant: Date, timeZone: string) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			weekday: 'short',
		})
			.formatToParts(instant)
			.map((p) => [p.type, p.value]),
	);
	return {
		year: Number(parts.year),
		month: Number(parts.month),
		day: Number(parts.day),
		weekdayIndex: WEEKDAY_ABBR.indexOf(String(parts.weekday)),
	};
}

export function nextRun(cadence: Cadence, from: Date = new Date()): Date {
	const minute = cadence.minute ?? 0;
	const local = localDateParts(from, cadence.timeZone);

	function candidateFor(daysAhead: number): Date {
		// Date.UTC normalises an out-of-range day (e.g. day 32) into the
		// correct next month, so this is safe across month/year boundaries.
		const d = new Date(Date.UTC(local.year, local.month - 1, local.day + daysAhead));
		return zonedWallClockToUtc(
			d.getUTCFullYear(),
			d.getUTCMonth() + 1,
			d.getUTCDate(),
			cadence.hour,
			minute,
			cadence.timeZone,
		);
	}

	let daysUntil = (cadence.dayOfWeek - local.weekdayIndex + 7) % 7;
	let candidate = candidateFor(daysUntil);
	if (candidate.getTime() <= from.getTime()) {
		daysUntil += 7;
		candidate = candidateFor(daysUntil);
	}
	return candidate;
}

function formatTimeOfDay(hour: number, minute: number): string {
	const period = hour < 12 ? 'AM' : 'PM';
	const displayHour = hour % 12 === 0 ? 12 : hour % 12;
	return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`;
}

export function describeCadence(cadence: Cadence): string {
	const day = DAY_NAMES[cadence.dayOfWeek];
	const time = formatTimeOfDay(cadence.hour, cadence.minute ?? 0);
	const zoneLabel = cadence.timeZone.split('/').pop()?.replace('_', ' ') ?? cadence.timeZone;
	return `Weekly, ${day}s at ${time}, ${zoneLabel} time`;
}

const briefCadence: Cadence = { type: 'weekly', dayOfWeek: 1, hour: 8, minute: 0, timeZone: 'Europe/London' };
const reviewCadence: Cadence = { type: 'weekly', dayOfWeek: 1, hour: 8, minute: 0, timeZone: 'Europe/London' };

export const scheduleTasks: ScheduleTask[] = [
	{
		name: 'Science & Biotech Brief',
		slug: 'science-biotech-brief',
		cadence: briefCadence,
		cadenceLabel: describeCadence(briefCadence),
		description:
			'A two-week rolling coverage window of biology, biotech, and pharma news — regulatory decisions, clinical trial results, deals, and basic-science findings — with every technical term explained in plain English at first use.',
		publishesTo: '/briefs',
		active: true,
	},
	{
		name: 'Bio Science Review',
		slug: 'bio-science-review',
		cadence: reviewCadence,
		cadenceLabel: describeCadence(reviewCadence),
		description:
			'A deep literature review of one specific topic in the biological sciences — abstract, background, mechanism, and discussion, with a full reference list and a downloadable Word document. Subfield rotates weekly across immunology, neuroscience, oncology, microbiology, genetics, and others.',
		publishesTo: '/reviews',
		active: true,
	},
];
