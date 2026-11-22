(function (JCT) {
	'use strict';

	const {
		parseHebrewYearAndSemester,
		semesterMatches,
		isExcludedCourse,
		getMoodleWwwroot,
		resolveUrl,
		parseDueDate,
		runWithConcurrency
	} = JCT.utils;

	const courseGradesMemCache = new Map();
	const inFlightGradeFetches = new Map();

	const DUE_DATE_REGEX =
		/(?:מסתיים|Due date|מועד הגשה|תאריך סיום|מועד סיום|עד תאריך|סגירה|מוגש עד|Due)[\s\S]{0,30}?((?:(?:יום [א-ת]+|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s*)?\d{1,2}\s+(?:[א-ת]+|[A-Za-z]+)\s+\d{4}(?:,\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)?)/i;

	// ---- Parse Assignment / VPL Page (extracts dueDate, status, and grade in one pass) ----

	function parseAssignmentPageHtml(html, assignmentUrl) {
		const parser = new DOMParser();
		const doc = parser.parseFromString(html, 'text/html');
		const bodyText = doc.body ? (doc.body.textContent || doc.body.innerText || '') : html.replace(/<[^>]+>/g, ' ');

		// 1. Due date
		let dueDate = null;
		const dateMatch = bodyText.match(DUE_DATE_REGEX);
		if (dateMatch) {
			dueDate = parseDueDate(dateMatch[1].trim());
		}

		// 2. Submission status & grade
		let status = null;
		let grade = null;
		const isVpl = Boolean(assignmentUrl && assignmentUrl.includes('/mod/vpl/'));

		const rows = Array.from(doc.querySelectorAll('table.generaltable tr, table tr'));
		const statusRow = rows.find((row) => {
			const th = row.querySelector('th');
			if (!th) return false;
			const txt = th.textContent || '';
			return txt.includes('מצב ההגשה') || /submission status/i.test(txt);
		});

		if (statusRow) {
			const statusCell = statusRow.querySelector('td');
			if (statusCell) {
				const statusText = statusCell.textContent.trim();
				if (
					statusText.includes('הוגש למתן ציון') ||
					statusText.includes('הוגש') ||
					/submitted for grading|submitted/i.test(statusText) ||
					statusCell.classList.contains('submissionstatussubmitted') ||
					statusCell.className.includes('submitted')
				) {
					status = 'submitted';
				} else if (
					statusText.includes('אין עדיין הגשות') ||
					statusText.includes('לא הוגש') ||
					/no submission|no attempt|not submitted/i.test(statusText)
				) {
					status = 'not_submitted';
				} else {
					status = 'not_submitted';
				}
			}
		} else if (isVpl) {
			// VPL pages show submission info outside Moodle's standard assign table
			if (
				bodyText.includes('הוגש בתאריך') ||
				bodyText.includes('הגשה אחרונה') ||
				/submitted on|last submission/i.test(bodyText)
			) {
				status = 'submitted';
			} else if (
				bodyText.includes('לא הוגש') ||
				bodyText.includes('אין הגשה') ||
				/not submitted|no submission/i.test(bodyText)
			) {
				status = 'not_submitted';
			}
		}

		const gradeRow = rows.find((row) => {
			const th = row.querySelector('th');
			if (!th) return false;
			const txt = th.textContent || '';
			return txt.includes('ציון') || /\bgrade\b/i.test(txt);
		});

		if (gradeRow) {
			const gradeCell = gradeRow.querySelector('td');
			if (gradeCell) {
				const raw = gradeCell.textContent.trim();
				if (raw && raw !== '-' && !raw.includes('לא ניתן ציון') && !/not graded/i.test(raw)) {
					grade = raw;
				}
			}
		}

		return { dueDate, status, grade };
	}

	// ---- Gradebook Fetcher (Deduplicated per Course) ----

	async function getCourseGrades(courseId, forceRefresh = false) {
		if (!courseId) return {};

		if (!forceRefresh && courseGradesMemCache.has(courseId)) {
			return courseGradesMemCache.get(courseId);
		}

		// Share an in-flight request if another caller already started fetching this course's grades
		if (inFlightGradeFetches.has(courseId)) {
			return inFlightGradeFetches.get(courseId);
		}

		const promise = (async () => {
			const cacheKey = `course_grades_v2_${courseId}`;
			if (!forceRefresh) {
				const res = await JCT.storage.storageGet('local', [cacheKey]);
				const cached = res[cacheKey];
				if (cached && cached.timestamp && JCT.storage.isCacheValid(cached.timestamp)) {
					courseGradesMemCache.set(courseId, cached.grades);
					return cached.grades;
				}
			}

			const grades = {};
			try {
				const url = `${getMoodleWwwroot()}/grade/report/user/index.php?id=${courseId}`;
				const response = await fetch(url, { method: 'GET', credentials: 'include' });
				if (response.ok) {
					const html = await response.text();
					const doc = new DOMParser().parseFromString(html, 'text/html');
					const rows = doc.querySelectorAll('table.user-grade tr, table tr');

					rows.forEach((row) => {
						const a = row.querySelector('th a, td a');
						if (!a) return;
						const href = a.getAttribute('href');
						if (!href || !href.includes('id=')) return;

						const match = href.match(/[?&]id=(\d+)/);
						if (!match) return;
						const assignId = match[1];

						let gradeCell = row.querySelector('td.column-grade, td.grade');
						if (!gradeCell) {
							for (const cell of row.querySelectorAll('td')) {
								const text = cell.textContent.trim();
								if (text && text !== '-' && /^[\d.]+/.test(text) && !text.includes('%') && text.length < 10) {
									gradeCell = cell;
									break;
								}
							}
						}

						if (gradeCell) {
							const gradeText = gradeCell.textContent.trim();
							if (gradeText && gradeText !== '-') {
								grades[assignId] = gradeText;
							}
						}
					});
				}
			} catch (e) {
				console.error(`[JCT] Error fetching grades for course ${courseId}:`, e);
			}

			courseGradesMemCache.set(courseId, grades);
			await JCT.storage.storageSet('local', { [cacheKey]: { timestamp: Date.now(), grades } });
			return grades;
		})();

		inFlightGradeFetches.set(courseId, promise);
		try {
			return await promise;
		} finally {
			inFlightGradeFetches.delete(courseId);
		}
	}

	// ---- Batched Enrichment (No Race Conditions, Single Fetch per Assignment, Single Gradebook per Course) ----

	async function enrichAssignments(assignments, options = {}) {
		const {
			forceRefreshDueDate = false,
			forceRefreshStatus = false,
			forceRefreshGrades = false
		} = options;

		if (!assignments || assignments.length === 0) return [];

		// Load caches once upfront
		const [dueDateCache, submissionStatusCache] = await Promise.all([
			JCT.storage.getDueDateCache(),
			JCT.storage.getSubmissionStatusCache()
		]);

		// Step 1: Fetch gradebooks ONCE per unique courseId
		const uniqueCourseIds = Array.from(new Set(assignments.map((a) => a.courseId).filter(Boolean)));
		const gradesByCourse = new Map();
		await runWithConcurrency(uniqueCourseIds, 4, async (cid) => {
			const grades = await getCourseGrades(cid, forceRefreshGrades);
			gradesByCourse.set(cid, grades);
		});

		// Step 2: Resolve due date & submission status per assignment (batched writes afterwards)
		const dueDateUpdates = {};
		const statusUpdates = {};

		const enriched = await runWithConcurrency(assignments, 5, async (assign) => {
			const id = assign.assignmentId;
			const statusKey = `submission_status_${id}`;

			const cachedDue = !forceRefreshDueDate && dueDateCache[id] !== undefined ? dueDateCache[id] : undefined;
			const cachedStatusEntry =
				!forceRefreshStatus &&
				submissionStatusCache[statusKey] &&
				JCT.storage.isCacheValid(submissionStatusCache[statusKey].timestamp)
					? submissionStatusCache[statusKey]
					: null;

			let dueDate = cachedDue !== undefined ? (cachedDue ? new Date(cachedDue) : null) : null;
			let submissionStatus = cachedStatusEntry ? cachedStatusEntry.status : null;
			let pageGrade = cachedStatusEntry ? cachedStatusEntry.grade || null : null;

			const needDueFetch = cachedDue === undefined;
			const needStatusFetch = forceRefreshStatus;

			if ((needDueFetch || needStatusFetch) && assign.assignmentUrl) {
				try {
					const response = await fetch(assign.assignmentUrl, { method: 'GET', credentials: 'include' });
					if (response.ok) {
						const html = await response.text();
						const parsed = parseAssignmentPageHtml(html, assign.assignmentUrl);

						if (needDueFetch) {
							dueDate = parsed.dueDate;
							dueDateUpdates[id] = dueDate ? dueDate.getTime() : null;
						}
						if (needStatusFetch && parsed.status) {
							submissionStatus = parsed.status;
							pageGrade = parsed.grade;
							statusUpdates[statusKey] = {
								status: parsed.status,
								grade: parsed.grade,
								timestamp: Date.now()
							};
						}
					} else if (needDueFetch) {
						dueDateUpdates[id] = null;
					}
				} catch (err) {
					console.error(`[JCT] Error fetching assignment ${id}:`, err);
				}
			}

			const courseGrades = gradesByCourse.get(assign.courseId) || {};
			const gradeFromGradebook = courseGrades[id] || null;

			return {
				...assign,
				dueDate,
				submissionStatus,
				grade: gradeFromGradebook || pageGrade || null
			};
		});

		// Atomic batch flush to chrome.storage.local (no lost-update races)
		await Promise.all([
			JCT.storage.mergeDueDateCache(dueDateUpdates),
			JCT.storage.mergeSubmissionStatusCache(statusUpdates)
		]);

		return enriched;
	}

	// ---- Course Scanner ----

	function collectUniqueCoursesFromPage() {
		const allCourseLinks = document.querySelectorAll('a[href*="/course/view.php"]');
		const uniqueCoursesMap = new Map();

		for (const link of allCourseLinks) {
			const href = link.getAttribute('href');
			if (!href) continue;
			const match = href.match(/[?&]id=(\d+)/);
			if (!match) continue;

			const courseId = match[1];
			const courseName = (link.textContent || link.innerText || '').trim();
			if (!uniqueCoursesMap.has(courseId) && courseName) {
				uniqueCoursesMap.set(courseId, { courseId, href, courseName });
			}
		}

		return uniqueCoursesMap;
	}

	function extractAssignmentFromLink(link, courseId, courseName, courseUrl, wwwroot, seenAssignmentIds) {
		const href = link.getAttribute('href');
		if (!href || href === '#') return null;

		const assignMatch = href.match(/[?&]id=(\d+)/);
		if (!assignMatch) return null;

		const assignId = assignMatch[1];
		if (seenAssignmentIds.has(assignId)) return null;

		const instanceNameEl = link.querySelector('.instancename');
		let name = (instanceNameEl ? instanceNameEl.textContent : link.textContent || '').trim();
		if (!name || name.length < 3) return null;

		name = name.replace(/\s+/g, ' ').trim();
		seenAssignmentIds.add(assignId);

		return {
			courseId,
			courseName,
			assignmentId: assignId,
			assignmentName: name,
			assignmentUrl: resolveUrl(href, wwwroot),
			courseUrl
		};
	}

	async function scanAllCoursesForAssignments(
		forceRefresh = false,
		filterYear = '',
		filterSemester = '',
		excludedCourseIds = new Set(),
		callbacks = {},
		retryCount = 0
	) {
		const { onProgress, onCourseResult } = callbacks;
		const { cache, timestamp, scanningInProgress } = await JCT.storage.getAssignmentsCache();

		if (scanningInProgress && !forceRefresh) {
			if (cache) {
				return {
					assignments: cache.assignments || [],
					courses: new Map(cache.courses || [])
				};
			}
			if (retryCount < 10) {
				await new Promise((r) => setTimeout(r, 1000));
				return scanAllCoursesForAssignments(
					forceRefresh,
					filterYear,
					filterSemester,
					excludedCourseIds,
					callbacks,
					retryCount + 1
				);
			}
		}

		if (!forceRefresh && cache && JCT.storage.isCacheValid(timestamp)) {
			return {
				assignments: cache.assignments || [],
				courses: new Map(cache.courses || [])
			};
		}

		await JCT.storage.setScanningInProgress(true);
		const allAssignments = [];
		const allCourses = new Map();

		try {
			const wwwroot = getMoodleWwwroot();
			const uniqueCoursesMap = collectUniqueCoursesFromPage();
			const targetYear = parseInt(filterYear, 10);

			const filteredCourses = Array.from(uniqueCoursesMap.values()).filter(({ courseId, courseName }) => {
				if (isExcludedCourse(courseName)) return false;
				const { year, semIdx } = parseHebrewYearAndSemester(courseName);
				if (year !== targetYear) return false;
				if (!semesterMatches(semIdx, filterSemester)) return false;
				if (excludedCourseIds && excludedCourseIds.has(courseId)) return false;
				return true;
			});

			const totalCourses = filteredCourses.length;
			let currentCourseIndex = 0;

			for (const { courseId, href, courseName: rawName } of filteredCourses) {
				if (JCT.state.stopScanning) {
					break;
				}

				const courseName = rawName || `קורס ${courseId}`;
				const courseUrl = resolveUrl(href, wwwroot);
				currentCourseIndex++;

				if (onProgress) {
					onProgress(currentCourseIndex, totalCourses, courseName);
				}

				allCourses.set(courseId, { courseId, courseName, courseUrl });

				try {
					const response = await fetch(courseUrl, { method: 'GET', credentials: 'include' });
					if (!response.ok) continue;

					const html = await response.text();
					const doc = new DOMParser().parseFromString(html, 'text/html');
					const seenAssignmentIds = new Set();
					const seenSectionUrls = new Set();
					const courseAssignments = [];

					const allInterestingLinks = doc.querySelectorAll(
						'a[href*="/course/section.php"], a[href*="/course/view.php"][href*="section="][href*="#tabs-tree-start"], a[href*="/mod/assign/view.php"], a[href*="/mod/vpl/view.php"]'
					);

					for (const link of allInterestingLinks) {
						if (JCT.state.stopScanning) break;

						const linkHref = link.getAttribute('href');
						if (!linkHref || linkHref === '#') continue;

						if (linkHref.includes('/mod/assign/view.php') || linkHref.includes('/mod/vpl/view.php')) {
							const assignment = extractAssignmentFromLink(
								link, courseId, courseName, courseUrl, wwwroot, seenAssignmentIds
							);
							if (assignment) {
								allAssignments.push(assignment);
								courseAssignments.push(assignment);
							}
						} else {
							const sectionUrl = resolveUrl(linkHref, wwwroot);
							if (seenSectionUrls.has(sectionUrl)) continue;
							seenSectionUrls.add(sectionUrl);

							try {
								const sectionResponse = await fetch(sectionUrl, { method: 'GET', credentials: 'include' });
								if (sectionResponse.ok) {
									const sectionHtml = await sectionResponse.text();
									const sectionDoc = new DOMParser().parseFromString(sectionHtml, 'text/html');
									const assignmentLinks = sectionDoc.querySelectorAll(
										'a[href*="/mod/assign/view.php"], a[href*="/mod/vpl/view.php"]'
									);
									assignmentLinks.forEach((assignLink) => {
										const assignment = extractAssignmentFromLink(
											assignLink, courseId, courseName, courseUrl, wwwroot, seenAssignmentIds
										);
										if (assignment) {
											allAssignments.push(assignment);
											courseAssignments.push(assignment);
										}
									});
								}
							} catch (sectionErr) {
								console.error(`[JCT] Error fetching section ${sectionUrl}:`, sectionErr);
							}
						}
					}

					if (onCourseResult) {
						onCourseResult({ courseId, courseName, courseUrl }, courseAssignments);
					}
				} catch (courseErr) {
					console.error(`[JCT] Error fetching course ${courseId}:`, courseErr);
					if (onCourseResult) {
						onCourseResult({ courseId, courseName, courseUrl }, []);
					}
				}
			}

			if (!JCT.state.stopScanning) {
				await JCT.storage.saveAssignmentsCache(allAssignments, allCourses);
			} else {
				await JCT.storage.setScanningInProgress(false);
			}

			return { assignments: allAssignments, courses: allCourses };
		} catch (error) {
			console.error('[JCT] Error during assignments scan:', error);
			await JCT.storage.setScanningInProgress(false);
			throw error;
		}
	}

	JCT.assignments = {
		getCourseGrades,
		enrichAssignments,
		collectUniqueCoursesFromPage,
		scanAllCoursesForAssignments
	};
})(window.JCT = window.JCT || {});

