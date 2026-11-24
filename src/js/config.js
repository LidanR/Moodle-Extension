(function (JCT) {
	'use strict';

	const SEMESTERS = [
		{ idx: 0, label: 'אלול', fullLabel: 'סמסטר אלול' },
		{ idx: 1, label: "א'", fullLabel: 'סמסטר א׳' },
		{ idx: 2, label: "ב'", fullLabel: 'סמסטר ב׳' }
	];

	const SEM_TO_IDX = { 'אלול': 0, '1': 0, 'א': 1, '2': 1, 'ב': 2, '3': 2, '4': 4 };
	const SEM_IDX_YEARLY = 4; // Yearly courses (spanning semesters of the year)

	// One color per semester (applies across all years): [אלול, סמסטר א', סמסטר ב']
	const DEFAULT_SEMESTER_COLORS = ['#f97316', '#2563eb', '#16a34a'];

	// Default header / brand gradient [startHex, endHex]
	const DEFAULT_HEADER_GRADIENT = ['#667eea', '#764ba2'];

	const HEADER_GRADIENT_PRESETS = [
		{ name: 'סגול קלאסי', colors: ['#667eea', '#764ba2'] },
		{ name: 'כחול אוקיינוס', colors: ['#2563eb', '#06b6d4'] },
		{ name: 'ירוק אמרלד', colors: ['#059669', '#10b981'] },
		{ name: 'שקיעה', colors: ['#f97316', '#ec4899'] },
		{ name: 'רובי', colors: ['#dc2626', '#f43f5e'] },
		{ name: 'אפור אלגנטי', colors: ['#1e293b', '#475569'] }
	];

	const DAYS_OF_WEEK = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
	const DAYS_OF_WEEK_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

	const HEBREW_MONTHS = [
		'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
		'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
	];

	const TODO_ICONS = ['📝', '📚', '💻', '🧪', '🎯', '📅', '⚡', '🔔', '💡', '✅'];

	const TODO_COLORS = [
		{ name: 'כחול', hex: '#3b82f6' },
		{ name: 'ירוק', hex: '#22c55e' },
		{ name: 'כתום', hex: '#f59e0b' },
		{ name: 'אדום', hex: '#ef4444' },
		{ name: 'סגול', hex: '#8b5cf6' },
		{ name: 'ורוד', hex: '#ec4899' },
		{ name: 'אפור', hex: '#64748b' }
	];

	const TODO_PRIORITIES = [
		{ id: 'high', label: 'גבוהה', color: '#ef4444', rank: 0 },
		{ id: 'medium', label: 'בינונית', color: '#f59e0b', rank: 1 },
		{ id: 'low', label: 'נמוכה', color: '#22c55e', rank: 2 }
	];

	const COURSE_CONTAINER_SELECTORS = [
		'.block_myoverview .courses-view',
		'.block_myoverview .list-group',
		'.block_myoverview [data-region="courses-view"] .list-group',
		'.block_myoverview .content .list-group',
		'.dashboard-card-deck',
		'#frontpage-course-list .courses',
		'#frontpage-course-list .course-list',
		'.course_category_tree .courses',
		'.course_category_tree .category-browse .courses'
	];

	const CARD_SELECTOR = [
		'.jct-courses-grid > .list-group-item',
		'.jct-courses-grid .list-group > .list-group-item',
		'.jct-courses-grid .coursebox',
		'.jct-courses-grid .card.course',
		'.jct-courses-grid .course-list > li',
		'.jct-courses-grid > .dashboard-card'
	].join(', ');

	const CARD_CLOSEST_SELECTOR = '.list-group-item, .coursebox, .card.course, li, .dashboard-card';
	const CARD_STYLE_SELECTOR = '.list-group-item, .coursebox, .card.course, .course-list > li';
	const COURSE_LINK_SELECTOR = 'a[href*="/course/view.php"], .coursename a, .course-title a';

	const EXCLUDED_COURSE_CODES = ['110102']; // "לימודי קודש"

	const DEFAULT_COLUMN_COUNT = 3;
	const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
	const SCAN_STALE_MS = 5 * 60 * 1000; // 5 minutes safety timeout for stuck scan lock

	JCT.config = {
		SEMESTERS,
		SEM_TO_IDX,
		SEM_IDX_YEARLY,
		DEFAULT_SEMESTER_COLORS,
		DEFAULT_HEADER_GRADIENT,
		HEADER_GRADIENT_PRESETS,
		DAYS_OF_WEEK,
		DAYS_OF_WEEK_EN,
		HEBREW_MONTHS,
		TODO_ICONS,
		TODO_COLORS,
		TODO_PRIORITIES,
		COURSE_CONTAINER_SELECTORS,
		CARD_SELECTOR,
		CARD_CLOSEST_SELECTOR,
		CARD_STYLE_SELECTOR,
		COURSE_LINK_SELECTOR,
		EXCLUDED_COURSE_CODES,
		DEFAULT_COLUMN_COUNT,
		CACHE_TTL_MS,
		SCAN_STALE_MS
	};

	// Shared mutable runtime state across modules
	JCT.state = {
		themeMode: 'light',
		headerGradient: DEFAULT_HEADER_GRADIENT.slice(),
		semesterColors: null,
		favoriteCourseIds: new Set(),
		courseSchedules: {},
		currentViewMode: 'grid',
		currentCardStyle: 'compact',
		currentColumnCount: DEFAULT_COLUMN_COUNT,
		hideWeeklySchedule: false,
		hideTodo: false,
		currentWeekOffset: 0,
		isReordering: false,
		stopScanning: false,
		isModalOpening: false
	};
})(window.JCT = window.JCT || {});
