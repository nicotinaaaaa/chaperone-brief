export interface WeeklyCadence {
	type: 'weekly';
	/** 0 = Sunday, per Date#getUTCDay() */
	dayOfWeek: number;
	hourUTC: number;
	minuteUTC?: number;
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

export function nextRun(cadence: Cadence, from: Date = new Date()): Date {
	const minute = cadence.minuteUTC ?? 0;
	const result = new Date(from);
	result.setUTCHours(cadence.hourUTC, minute, 0, 0);

	const currentDay = result.getUTCDay();
	let daysUntil = (cadence.dayOfWeek - currentDay + 7) % 7;
	if (daysUntil === 0 && result.getTime() <= from.getTime()) {
		daysUntil = 7;
	}
	result.setUTCDate(result.getUTCDate() + daysUntil);
	return result;
}

export function describeCadence(cadence: Cadence): string {
	const day = DAY_NAMES[cadence.dayOfWeek];
	const hour = String(cadence.hourUTC).padStart(2, '0');
	const minute = String(cadence.minuteUTC ?? 0).padStart(2, '0');
	return `Weekly, ${day}s at ${hour}:${minute} UTC`;
}

// Placeholder day/time — the two tasks' exact cadence hasn't been fixed yet.
// Edit dayOfWeek/hourUTC below once it has; everything else derives from it.
export const scheduleTasks: ScheduleTask[] = [
	{
		name: 'Science & Biotech Brief',
		slug: 'science-biotech-brief',
		cadence: { type: 'weekly', dayOfWeek: 0, hourUTC: 6 },
		cadenceLabel: describeCadence({ type: 'weekly', dayOfWeek: 0, hourUTC: 6 }),
		description:
			'A two-week rolling coverage window of biology, biotech, and pharma news — regulatory decisions, clinical trial results, deals, and basic-science findings — with every technical term explained in plain English at first use.',
		publishesTo: '/briefs',
		active: true,
	},
	{
		name: 'Bio Science Review',
		slug: 'bio-science-review',
		cadence: { type: 'weekly', dayOfWeek: 3, hourUTC: 6 },
		cadenceLabel: describeCadence({ type: 'weekly', dayOfWeek: 3, hourUTC: 6 }),
		description:
			'A deep literature review of one specific topic in the biological sciences — abstract, background, mechanism, and discussion, with a full reference list and a downloadable Word document. Subfield rotates weekly across immunology, neuroscience, oncology, microbiology, genetics, and others.',
		publishesTo: '/reviews',
		active: true,
	},
];
