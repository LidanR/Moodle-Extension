(function (JCT) {
	'use strict';

	const {
		SEM_TO_IDX,
		SEM_IDX_YEARLY,
		DEFAULT_SEMESTER_COLORS,
		HEBREW_MONTHS,
		CARD_STYLE_SELECTOR,
		COURSE_LINK_SELECTOR,
		EXCLUDED_COURSE_CODES
	} = JCT.config;

	const HEBREW_MONTH_MAP = HEBREW_MONTHS.reduce((acc, name, idx) => {
		acc[name] = idx;
		return acc;
	}, {});

	const ENGLISH_MONTH_MAP = {
		january: 0, jan: 0,
		february: 1, feb: 1,
		march: 2, mar: 2,
		april: 3, apr: 3,
		may: 4,
		june: 5, jun: 5,
		july: 6, jul: 6,
		august: 7, aug: 7,
		september: 8, sep: 8, sept: 8,
		october: 9, oct: 9,
		november: 10, nov: 10,
		december: 11, dec: 11
	};

	// Gematria values for algorithmic Hebrew year encode/decode (future-proof for any year)
	const GEMATRIA_VALUES = {
		'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9,
		'י': 10, 'כ': 20, 'ך': 20, 'ל': 30, 'מ': 40, 'ם': 40, 'נ': 50, 'ן': 50,
		'ס': 60, 'ע': 70, 'פ': 80, 'ף': 80, 'צ': 90, 'ץ': 90,
		'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400
	};

	const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת'];
	const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
	const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];

	function hebrewYearToGematria(yearNum) {
		const num = parseInt(yearNum, 10);
		if (isNaN(num) || num < 5000 || num > 5999) return String(yearNum || '');

		let rem = num % 1000;
		let letters = '';

		while (rem >= 400) {
			letters += 'ת';
			rem -= 400;
		}
		if (rem >= 100) {
			letters += HUNDREDS[Math.floor(rem / 100)];
			rem %= 100;
		}
		if (rem === 15) {
			letters += 'טו';
		} else if (rem === 16) {
			letters += 'טז';
		} else {
			if (rem >= 10) {
				letters += TENS[Math.floor(rem / 10)];
				rem %= 10;
			}
			if (rem > 0) {
				letters += ONES[rem];
			}
		}

		if (letters.length === 0) return String(num);
		if (letters.length === 1) return `${letters}׳`;
		return `${letters.slice(0, -1)}״${letters.slice(-1)}`;
	}

	function gematriaToHebrewYear(str) {
		if (!str) return null;
		const clean = str.replace(/["'״׳\s]/g, '');
		if (!clean || !/^ת[שת]/.test(clean)) return null;

		let sum = 0;
		for (const ch of clean) {
			const val = GEMATRIA_VALUES[ch];
			if (!val) return null;
			sum += val;
		}
		if (sum < 700 || sum > 999) return null;
		return 5000 + sum;
	}

	function getCurrentHebrewYear() {
		try {
			const parts = new Intl.DateTimeFormat('en-u-ca-hebrew', { year: 'numeric' }).formatToParts(new Date());
			const yearPart = parts.find(p => p.type === 'year');
			if (yearPart) {
				const parsed = parseInt(yearPart.value, 10);
				if (parsed >= 5700 && parsed <= 5999) return parsed;
			}
		} catch (_e) { /* fallback below */ }
		const now = new Date();
		return now.getFullYear() + (now.getMonth() >= 8 ? 3761 : 3760);
	}

	function escapeHtml(str) {
		if (str == null) return '';
		return String(str)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function hexToHsl(hex) {
		let clean = (hex || '').replace('#', '').trim();
		if (!clean) return { h: 220, s: 60, l: 60 };
		if (clean.length === 3) {
			clean = clean.split('').map(c => c + c).join('');
		}
		if (clean.length !== 6) return { h: 220, s: 60, l: 60 };

		const r = parseInt(clean.substring(0, 2), 16) / 255;
		const g = parseInt(clean.substring(2, 4), 16) / 255;
		const b = parseInt(clean.substring(4, 6), 16) / 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		let h = 0;
		let s = 0;
		let l = (max + min) / 2;

		if (max !== min) {
			const d = max - min;
			s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
			if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
			else if (max === g) h = (b - r) / d + 2;
			else h = (r - g) / d + 4;
			h *= 60;
		}

		h = Math.round(((h % 360) + 360) % 360);
		s = Math.round((s || 0) * 100);
		l = Math.round(l * 100);
		return {
			h,
			s: Math.max(35, Math.min(90, s)),
			l: Math.max(35, Math.min(70, l))
		};
	}

	function parseHebrewYearAndSemester(txt) {
		const text = txt || '';
		let y = null;
		let s = null;

		// 1. Detect Hebrew year algorithmically (works for any future year: תשפ״ד, תש״צ, תשצ״א, ת״ת, ...)
		const yMatches = text.match(/ת["'״׳]?[שת][א-ת"'״׳]{0,4}/g);
		if (yMatches) {
			for (const candidate of yMatches) {
				const parsed = gematriaToHebrewYear(candidate);
				if (parsed) {
					y = parsed;
					break;
				}
			}
		}
		if (!y) {
			const nMatch = text.match(/\b5[789][0-9]{2}\b/);
			y = nMatch ? parseInt(nMatch[0], 10) : null;
		}

		// 2. Detect semester (including yearly courses: .4. in code or explicit "שנתי")
		if (/\d+\.4\.\d+/.test(text) || /(?:^|[\s\-–(])שנתי(?:$|[\s\-–)])/.test(text)) {
			s = SEM_IDX_YEARLY;
		} else if (text.includes('אלול')) {
			s = 0;
		} else {
			const sMatch = text.match(/(?<=^|\W)(א|ב|1|2|3)(?=\W|$)/);
			s = sMatch ? SEM_TO_IDX[sMatch[1]] : null;
		}

		return { year: y, semIdx: s };
	}

	function semesterMatches(semIdx, filterSemester) {
		const fSem = parseInt(filterSemester, 10);
		if (semIdx === fSem) return true;
		// Yearly courses span across the semesters of that year (אלול / א' / ב')
		if (semIdx === SEM_IDX_YEARLY && (fSem === 0 || fSem === 1 || fSem === 2)) return true;
		return false;
	}

	function getSemesterName(year, semIdx) {
		if (!year && semIdx == null) return 'קורסים';
		const semesterNames = ['סמסטר אלול', 'סמסטר א׳', 'סמסטר ב׳'];
		const yearName = year ? hebrewYearToGematria(year) : '';
		if (semIdx === SEM_IDX_YEARLY) return yearName ? `שנתי ${yearName}` : 'קורסים שנתיים';
		const semLabel = semesterNames[semIdx] || 'סמסטר';
		return yearName ? `${semLabel} ${yearName}` : semLabel;
	}

	function getSemesterColors() {
		const colors = JCT.state.semesterColors;
		if (Array.isArray(colors) && colors.length >= 3) {
			return [
				colors[0] || DEFAULT_SEMESTER_COLORS[0],
				colors[1] || DEFAULT_SEMESTER_COLORS[1],
				colors[2] || DEFAULT_SEMESTER_COLORS[2]
			];
		}
		return DEFAULT_SEMESTER_COLORS.slice();
	}

	// Returns primary HSL color + optional secondary HSL for yearly courses (gradient spanning א' and ב')
	function colorFor(semIdx) {
		const colors = getSemesterColors();
		if (semIdx === SEM_IDX_YEARLY) {
			const primary = hexToHsl(colors[1]);
			const secondary = hexToHsl(colors[2]);
			return { ...primary, isYearly: true, secondary };
		}
		if (semIdx === 0 || semIdx === 1 || semIdx === 2) {
			return { ...hexToHsl(colors[semIdx]), isYearly: false, secondary: null };
		}
		return { h: 225, s: 55, l: 55, isYearly: false, secondary: null };
	}

	function isExcludedCourse(courseName) {
		if (!courseName) return false;
		return EXCLUDED_COURSE_CODES.some(code => courseName.includes(code));
	}

	function getCourseIdFromCard(card) {
		if (!card) return null;
		const mainLink = card.querySelector(COURSE_LINK_SELECTOR);
		if (mainLink && mainLink.href) {
			const m = mainLink.href.match(/[?&]id=(\d+)/);
			if (m) return m[1];
		}
		const idFromAttr = card.getAttribute('data-course-id') || card.dataset?.courseId;
		return idFromAttr ? String(idFromAttr) : null;
	}

	function getCourseNameFromCard(card) {
		if (!card) return 'קורס ללא שם';
		const nameEl = card.querySelector(
			'.coursename a, .course-title a, .list-group-item a.course-title, .list-group-item .coursename a, a[href*="/course/view.php"]'
		);
		if (nameEl) {
			const txt = (nameEl.textContent || nameEl.innerText || '').trim();
			if (txt) return txt;
		}
		return (card.textContent || '').trim().split('\n')[0] || 'קורס ללא שם';
	}

	function getCourseUrlFromCard(card) {
		if (!card) return '#';
		const link = card.querySelector(COURSE_LINK_SELECTOR);
		return link && link.href ? link.href : '#';
	}

	function getStyledCardEl(card) {
		if (!card) return null;
		if (card.matches && card.matches(CARD_STYLE_SELECTOR)) return card;
		return card.querySelector(CARD_STYLE_SELECTOR) || card;
	}

	function getPlaceholderUrl() {
		return chrome.runtime.getURL('assets/placeholder.svg');
	}

	function getMoodleWwwroot() {
		return window.M?.cfg?.wwwroot || window.location.origin;
	}

	function resolveUrl(href, wwwroot) {
		if (!href) return '';
		if (href.startsWith('http://') || href.startsWith('https://')) return href;
		const base = (wwwroot || getMoodleWwwroot()).replace(/\/+$/, '');
		return href.startsWith('/') ? `${base}${href}` : `${base}/${href}`;
	}

	// Parse YYYY-MM-DD strictly in local timezone (avoids UTC midnight shift bugs)
	function parseLocalDate(dateStr) {
		if (!dateStr) return null;
		const isoMatch = String(dateStr).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
		if (isoMatch) {
			return new Date(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10));
		}
		const parsed = new Date(dateStr);
		return isNaN(parsed.getTime()) ? null : parsed;
	}

	function formatLocalDateInput(date = new Date()) {
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, '0');
		const d = String(date.getDate()).padStart(2, '0');
		return `${y}-${m}-${d}`;
	}

	// Parse Hebrew or English Moodle due-date string to Date object
	function parseDueDate(dateStr) {
		if (!dateStr) return null;
		try {
			const cleaned = dateStr
				.replace(/יום [א-ת]+,\s*/, '')
				.replace(/^(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s*/i, '')
				.trim();

			const [datePart, timePart] = cleaned.split(',').map(s => s.trim());
			const dateParts = datePart.split(/\s+/);

			if (dateParts.length >= 3) {
				const day = parseInt(dateParts[0], 10);
				const monthToken = dateParts[1];
				const year = parseInt(dateParts[2], 10);
				let month = HEBREW_MONTH_MAP[monthToken];
				if (month === undefined) {
					month = ENGLISH_MONTH_MAP[monthToken.toLowerCase()];
				}

				if (!isNaN(day) && month !== undefined && !isNaN(year)) {
					let hours = 23;
					let minutes = 59;

					if (timePart) {
						const timeMatch = timePart.match(/(\d{1,2}):(\d{2})/);
						if (timeMatch) {
							hours = parseInt(timeMatch[1], 10);
							minutes = parseInt(timeMatch[2], 10);
							if (/PM/i.test(timePart) && hours < 12) {
								hours += 12;
							} else if (/AM/i.test(timePart) && hours === 12) {
								hours = 0;
							}
						}
					}
					return new Date(year, month, day, hours, minutes);
				}
			}

			return null;
		} catch (error) {
			console.error('[JCT] Error parsing date:', error);
			return null;
		}
	}

	function shouldShowAssignment(dueDate, maxOverdueDays) {
		if (!dueDate) return true;
		const now = new Date();
		if (dueDate >= now) return true;
		if (!maxOverdueDays || maxOverdueDays <= 0) return true;
		const msPerDay = 24 * 60 * 60 * 1000;
		const daysOverdue = Math.floor((now - dueDate) / msPerDay);
		return daysOverdue <= maxOverdueDays;
	}

	async function runWithConcurrency(items, limit, worker) {
		const results = new Array(items.length);
		let nextIndex = 0;

		async function runner() {
			while (nextIndex < items.length) {
				const idx = nextIndex++;
				results[idx] = await worker(items[idx], idx);
			}
		}

		const workerCount = Math.min(Math.max(1, limit), items.length);
		await Promise.all(Array.from({ length: workerCount }, () => runner()));
		return results;
	}

	JCT.utils = {
		hebrewYearToGematria,
		gematriaToHebrewYear,
		getCurrentHebrewYear,
		escapeHtml,
		hexToHsl,
		parseHebrewYearAndSemester,
		semesterMatches,
		getSemesterName,
		getSemesterColors,
		colorFor,
		isExcludedCourse,
		getCourseIdFromCard,
		getCourseNameFromCard,
		getCourseUrlFromCard,
		getStyledCardEl,
		getPlaceholderUrl,
		getMoodleWwwroot,
		resolveUrl,
		parseLocalDate,
		formatLocalDateInput,
		parseDueDate,
		shouldShowAssignment,
		runWithConcurrency
	};
})(window.JCT = window.JCT || {});
